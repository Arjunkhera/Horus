FROM node:20-alpine
WORKDIR /app
COPY packages/reader-server/package.json .
RUN npm install --production
COPY packages/reader-server/ .
COPY packages/reader/ ./public/
ENV READER_STATIC=/app/public
EXPOSE 8400
CMD ["node", "server.js"]
