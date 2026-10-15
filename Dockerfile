FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/runtime/ ./src/runtime/
COPY src/classification.js src/zip.js src/errors.js ./src/
COPY public-hub/ ./public-hub/
USER node
EXPOSE 8080
CMD ["node", "src/runtime/main.js"]
