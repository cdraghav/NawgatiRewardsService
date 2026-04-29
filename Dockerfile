FROM node:24
COPY . .
RUN yarn
RUN yarn run build
EXPOSE 3000
CMD [ "node", "build/index.js" ]