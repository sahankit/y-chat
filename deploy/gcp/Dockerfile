FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json server.js ./
RUN npm ci --omit=dev
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
