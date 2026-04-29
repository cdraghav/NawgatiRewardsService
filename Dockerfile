FROM node:24
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --production
COPY . .
EXPOSE 4000
CMD [ "node", "src/index.js" ]
