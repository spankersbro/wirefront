// Stands in for the Firebase compat SDK in tests. No network code: the test
// drives presence events through window.__fakeRtdb instead of live RTDB.
// Simplified on purpose: every ref shares one listener map whatever its path, and
// remove() does not echo a child_removed, so the stale sweep is not modelled.
(function () {
  var listeners = {};
  var noop = function () {};

  function ref() {
    return {
      on: function (event, callback) { (listeners[event] = listeners[event] || []).push(callback); },
      once: function (event, callback) { (listeners['once:' + event] = listeners['once:' + event] || []).push(callback); },
      set: noop,
      remove: noop,
      onDisconnect: function () { return { remove: noop }; },
    };
  }

  function emit(event, key, value) {
    (listeners[event] || []).forEach(function (callback) {
      callback({ key: key, val: function () { return value; } });
    });
  }

  window.__fakeRtdb = {
    emit: emit,
    finishInitialLoad: function () { emit('once:value'); },
  };

  var query = { orderBy: function () { return query; }, limit: function () { return query; }, onSnapshot: noop };
  window.firebase = {
    initializeApp: noop,
    firestore: function () { return { collection: function () { return query; } }; },
    database: function () { return { ref: ref }; },
  };
})();
