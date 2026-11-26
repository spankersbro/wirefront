// Stands in for the Firebase compat SDK in tests. No network code: the test
// drives presence events through window.__fakeRtdb instead of live RTDB.
// Simplified on purpose: every ref shares one listener map whatever its path, except
// '.info/...' paths, which get their own. remove() is recorded but does not echo a child_removed.
(function () {
  var listeners = {};
  var writes = [];
  var removes = [];
  var disconnectRemoves = [];
  var noop = function () {};
  var SERVER_TIMESTAMP = { '.sv': 'timestamp' };

  function listenerKey(path, event) {
    return path && path.indexOf('.info/') === 0 ? path + ':' + event : event;
  }

  function ref(path) {
    return {
      on: function (event, callback) { var key = listenerKey(path, event); (listeners[key] = listeners[key] || []).push(callback); },
      once: function (event, callback) { (listeners['once:' + event] = listeners['once:' + event] || []).push(callback); },
      set: function (value) { writes.push({ path: path, value: value }); return Promise.resolve(); },
      remove: function () { removes.push(path); return window.__fakeRtdb.refuseRemoves ? Promise.reject(new Error('PERMISSION_DENIED')) : Promise.resolve(); },
      onDisconnect: function () { return { remove: function () { disconnectRemoves.push(path); } }; },
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
    removes: removes,
    disconnectRemoves: disconnectRemoves,
    uid: 'fake-anon-uid',
    finishInitialLoad: function () { emit('once:value'); },
    setServerTimeOffset: function (offsetMs) { emit('.info/serverTimeOffset:value', null, offsetMs); },
  };

  var scoreAdds = [];
  window.__fakeFirestore = { adds: scoreAdds };
  var query = {
    orderBy: function () { return query; },
    limit: function () { return query; },
    onSnapshot: noop,
    add: function (doc) { scoreAdds.push(doc); return Promise.resolve(); },
  };
  var database = function () { return { ref: ref }; };
  database.ServerValue = { TIMESTAMP: SERVER_TIMESTAMP };
  window.firebase = {
    initializeApp: noop,
    firestore: function () { return { collection: function () { return query; } }; },
    database: database,
    auth: fakeAuth,
  };

  // Like the real SDK: with session persistence the uid lives in sessionStorage (one per tab);
  // otherwise every tab of the browser shares one uid.
  var signedInUser = null;
  function fakeAuth() {
    return {
      get currentUser() { return signedInUser; },
      setPersistence: function (persistence) {
        window.__fakeRtdb.persistence = persistence;
        return Promise.resolve();
      },
      signInAnonymously: function () {
        var uid = window.__fakeRtdb.uid;
        if (window.__fakeRtdb.persistence === 'session') {
          uid = sessionStorage.getItem('fakeAnonUid') || 'fake-anon-uid-' + Math.random().toString(36).slice(2, 10);
          sessionStorage.setItem('fakeAnonUid', uid);
        }
        signedInUser = { uid: uid, getIdToken: function () { return Promise.resolve('fake-id-token'); } };
        return Promise.resolve({ user: signedInUser });
      },
    };
  }
  fakeAuth.Auth = { Persistence: { LOCAL: 'local', NONE: 'none', SESSION: 'session' } };
})();
