'use strict';

const config = require('./config');
const app = require('./app');

if (config.env === 'production' && config.payments.mode === 'mock') console.warn('WARNING: payments are in mock mode. Set the RAZORPAY_* keys before taking real orders.');
if (config.runJobs && config.env !== 'test') require('./jobs').start();

app.listen(config.port, () => {
  console.log(`Hospi Bazaar API listening on http://localhost:${config.port} (${config.env})`);
});
