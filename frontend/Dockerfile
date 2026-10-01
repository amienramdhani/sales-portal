FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
FROM scratch
COPY --from=build /src/dist /dist
