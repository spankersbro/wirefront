// Stands in for the Firebase compat SDK in tests. No network code: the test
// drives presence events through window.__fakeRtdb instead of live RTDB.
// Simplified on purpose: every ref shares one listener map whatever its path, and
// remove() does not echo a child_removed, so the stale sweep is not modelled.
(function () {
  var listeners = {};
  var writes = [];
  var noop = function () {};
  var SERVER_TIMESTAMP = { '.sv': 'timestamp' };

  function ref(path) {
    return {
      on: function (event, callback) { (listeners[event] = listeners[event] || []).push(callback); },
      once: function (event, callback) { (listeners['once:' + event] = listeners['once:' + event] || []).push(callback); },
      set: function (value) { writes.push({ path: path, value: value }); return Promise.resolve(); },
      remove: function () { return window.__fakeRtdb.refuseRemoves ? Promise.reject(new Error('PERMISSION_DENIED')) : Promise.resolve(); },
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
    writes: writes,
    uid: 'fake-anon-uid',
    finishInitialLoad: function () { emit('once:value'); },
  };

  var query = { orderBy: function () { return query; }, limit: function () { return query; }, onSnapshot: noop };
  var database = function () { return { ref: ref }; };
  database.ServerValue = { TIMESTAMP: SERVER_TIMESTAMP };
  window.firebase = {
    initializeApp: noop,
    firestore: function () { return { collection: function () { return query; } }; },
    database: database,
    auth: function () {
      return { signInAnonymously: function () { return Promise.resolve({ user: { uid: window.__fakeRtdb.uid } }); } };
    },
  };
})();
