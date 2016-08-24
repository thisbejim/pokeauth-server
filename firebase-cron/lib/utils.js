import cron from 'cron';
import moment from 'moment';
import eachOf from 'async/eachOf';

let remote;
const remoteDate = function(ref) {
  if (remote) return remote;

  var offset = 0;
  ref.child('/.info/serverTimeOffset').on('value', function(snapshot) {
    offset = snapshot.val() || 0;
  });

  remote = function() {
    return Date.now() + offset;
  };

  return remote;
};

/**
 * Expose `utils` modules
 */
const utils = {
  cron,
  moment,
  eachOf,
  remoteDate,
}

module.exports = utils;
