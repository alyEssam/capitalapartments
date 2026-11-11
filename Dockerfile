FROM node:22-slim

WORKDIR /app

COPY package.json ./

# Zero npm install needed - built-in node:sqlite!

COPY . .

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
