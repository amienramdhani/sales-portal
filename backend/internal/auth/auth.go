package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Account struct {
	NIK, Salt, Hash string
	Active          bool
	Version         int
	MustChange      bool
	Failed          int
	LockUntil       *time.Time
}
type Session struct {
	ID, NIK, EffectiveNIK, Role string
	Version                     int
	Demo                        bool
	ExpiresAt                   time.Time
}

type Service struct {
	DB     *pgxpool.Pool
	Pepper string
	TTL    time.Duration
}

func LegacyHash(pepper, nik, salt, pin string) string {
	m := hmac.New(sha256.New, []byte(pepper))
	m.Write([]byte(nik + "|" + salt + "|" + pin))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Service) Login(ctx context.Context, nik, pin string) (Session, bool, error) {
	nik = strings.TrimSpace(nik)
	if nik == "" || pin == "" {
		return Session{}, false, errors.New("NIK atau PIN tidak sesuai")
	}
	var a Account
	var lock *time.Time
	err := s.DB.QueryRow(ctx, `select nik,salt,pin_hash,aktif,versi,wajib_ganti,gagal,lock_until from auth_accounts where nik=$1`, nik).Scan(&a.NIK, &a.Salt, &a.Hash, &a.Active, &a.Version, &a.MustChange, &a.Failed, &lock)
	if err != nil || !a.Active {
		return Session{}, false, errors.New("NIK atau PIN tidak sesuai")
	}
	a.LockUntil = lock
	if a.LockUntil != nil && a.LockUntil.After(time.Now()) {
		return Session{}, false, errors.New("Akun sementara terkunci")
	}
	got := LegacyHash(s.Pepper, a.NIK, a.Salt, pin)
	if !hmac.Equal([]byte(got), []byte(a.Hash)) {
		a.Failed++
		var until any = nil
		if a.Failed >= 5 {
			u := time.Now().Add(15 * time.Minute)
			until = u
		}
		_, _ = s.DB.Exec(ctx, `update auth_accounts set gagal=$2,lock_until=$3 where nik=$1`, a.NIK, a.Failed, until)
		return Session{}, false, errors.New("NIK atau PIN tidak sesuai")
	}
	_, _ = s.DB.Exec(ctx, `update auth_accounts set gagal=0,lock_until=null where nik=$1`, a.NIK)
	var role string
	if err := s.DB.QueryRow(ctx, `select effective_role from people_effective where nik=$1`, a.NIK).Scan(&role); err != nil {
		return Session{}, false, fmt.Errorf("role pengguna tidak tersedia: %w", err)
	}
	sess, err := s.NewSession(ctx, a.NIK, a.NIK, role, a.Version, false)
	return sess, a.MustChange, err
}

func (s *Service) NewSession(ctx context.Context, nik, effective, role string, version int, demo bool) (Session, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return Session{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(b)
	exp := time.Now().Add(s.TTL)
	_, err := s.DB.Exec(ctx, `insert into sessions(id,nik,effective_nik,role,auth_version,demo,expires_at) values($1,$2,$3,$4,$5,$6,$7)`, id, nik, effective, role, version, demo, exp)
	return Session{ID: id, NIK: nik, EffectiveNIK: effective, Role: role, Version: version, Demo: demo, ExpiresAt: exp}, err
}
func (s *Service) GetSession(ctx context.Context, id string) (Session, error) {
	var x Session
	err := s.DB.QueryRow(ctx, `select s.id,s.nik,s.effective_nik,s.role,s.auth_version,s.demo,s.expires_at from sessions s join auth_accounts a on a.nik=s.nik where s.id=$1 and s.expires_at>now() and a.aktif=true and a.versi=s.auth_version`, id).Scan(&x.ID, &x.NIK, &x.EffectiveNIK, &x.Role, &x.Version, &x.Demo, &x.ExpiresAt)
	return x, err
}
func (s *Service) Logout(ctx context.Context, id string) error {
	_, err := s.DB.Exec(ctx, `delete from sessions where id=$1`, id)
	return err
}
func (s *Service) ChangePIN(ctx context.Context, sess Session, pin string) error {
	if len(pin) != 4 {
		return errors.New("PIN harus 4 digit")
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return errors.New("PIN harus 4 digit")
		}
	}
	var salt string
	if err := s.DB.QueryRow(ctx, `select salt from auth_accounts where nik=$1`, sess.NIK).Scan(&salt); err != nil {
		return err
	}
	hash := LegacyHash(s.Pepper, sess.NIK, salt, pin)
	_, err := s.DB.Exec(ctx, `update auth_accounts set pin_hash=$2,versi=versi+1,wajib_ganti=false,gagal=0,lock_until=null,updated_at=now() where nik=$1`, sess.NIK, hash)
	if err == nil {
		_, _ = s.DB.Exec(ctx, `delete from sessions where nik=$1`, sess.NIK)
	}
	return err
}
func (s *Service) StartDemo(ctx context.Context, sess Session, target string) (Session, error) {
	// Legacy Apps Script keeps the same token and changes the effective identity stored in the session.
	// Keeping the token stable is important because the production UI does not replace TOKEN after apiStartDemo.
	if sess.Role != "SUPER ADMIN" || sess.Demo {
		return Session{}, errors.New("khusus Super Admin")
	}
	var role string
	var active bool
	err := s.DB.QueryRow(ctx, `select p.effective_role,a.aktif from people_effective p join auth_accounts a on a.nik=p.nik where p.nik=$1`, target).Scan(&role, &active)
	if err != nil || !active {
		return Session{}, errors.New("akun target tidak aktif")
	}
	if role == "ADMIN" || role == "SUPER ADMIN" {
		return Session{}, errors.New("akun Admin/Super Admin tidak boleh dipakai demo")
	}
	_, err = s.DB.Exec(ctx, `update sessions set effective_nik=$2,role=$3,demo=true where id=$1`, sess.ID, target, role)
	if err != nil {
		return Session{}, err
	}
	sess.EffectiveNIK, sess.Role, sess.Demo = target, role, true
	return sess, nil
}
func (s *Service) StopDemo(ctx context.Context, sess Session) (Session, error) {
	if !sess.Demo {
		return sess, nil
	}
	var role string
	if err := s.DB.QueryRow(ctx, `select effective_role from people_effective where nik=$1`, sess.NIK).Scan(&role); err != nil {
		return Session{}, err
	}
	_, err := s.DB.Exec(ctx, `update sessions set effective_nik=nik,role=$2,demo=false where id=$1`, sess.ID, role)
	if err != nil {
		return Session{}, err
	}
	sess.EffectiveNIK, sess.Role, sess.Demo = sess.NIK, role, false
	return sess, nil
}

func (s *Service) ResetPIN(ctx context.Context, nik string) (string, error) {
	// Match legacy behavior: random four-digit temporary PIN, new salt, version bump, force change.
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	n := (int(b[0])<<16 | int(b[1])<<8 | int(b[2])) % 10000
	pin := fmt.Sprintf("%04d", n)
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", err
	}
	salt := base64.RawURLEncoding.EncodeToString(saltBytes)
	hash := LegacyHash(s.Pepper, nik, salt, pin)
	ct, err := s.DB.Exec(ctx, `update auth_accounts set salt=$2,pin_hash=$3,aktif=true,versi=versi+1,wajib_ganti=true,gagal=0,lock_until=null,updated_at=now() where nik=$1`, nik, salt, hash)
	if err != nil {
		return "", err
	}
	if ct.RowsAffected() == 0 {
		_, err = s.DB.Exec(ctx, `insert into auth_accounts(nik,salt,pin_hash,aktif,versi,wajib_ganti,gagal) values($1,$2,$3,true,1,true,0)`, nik, salt, hash)
		if err != nil {
			return "", err
		}
	}
	_, _ = s.DB.Exec(ctx, `delete from sessions where nik=$1`, nik)
	return pin, nil
}

func (s *Service) SetActive(ctx context.Context, nik string, active bool) error {
	ct, err := s.DB.Exec(ctx, `update auth_accounts set aktif=$2,versi=versi+1,updated_at=now() where nik=$1`, nik, active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return errors.New("Buat PIN terlebih dahulu.")
	}
	_, _ = s.DB.Exec(ctx, `delete from sessions where nik=$1`, nik)
	return nil
}
