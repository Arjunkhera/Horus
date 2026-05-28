FROM node:20-alpine
WORKDIR /app
COPY packages/horus-ui/package.json .
RUN npm install --production
COPY packages/horus-ui/ .
COPY packages/horus-ui-client/ ./public/
ENV READER_STATIC=/app/public
EXPOSE 8400
CMD ["node", "server.js"]
