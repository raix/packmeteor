// FIFO
module.exports = function() {
  var self = this;
  var invokations = [];

  self.add = function(f) {
    if (typeof f !== 'function') {
      throw new Error('queue requires function');
    }
    invokations.push(f);
  };

  self.next = function(text) {
    if (text) {
      console.log('LOG: ' + text);
    }
    if (invokations.length) {
      var f = invokations.shift();
      setTimeout(function() {
        // Run function
        f(self.next);
      }, 0);
    }
  };

  self.run = self.next;
};