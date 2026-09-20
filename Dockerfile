FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
EXPOSE 6025
ENV PORT=6025 NODE_ENV=production
CMD ["node", "src/index.js"]
