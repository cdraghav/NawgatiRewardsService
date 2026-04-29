/* eslint-disable import/first */
process.env.TZ = 'Asia/Kolkata';


import { createServer } from 'http';

import app  from './app';

const port = process.env.PORT || 4000;

const server = createServer(app);

server.listen(port, () => {
  console.log(`NawgatiRewardsService is listening on port ${port}`);
});