// Counts Gemini calls per UTC day in Firestore, so the daily limit survives restarts and deploys.
// Clients cannot read or write this collection: firestore.rules only opens /scores.
function makeDailyUsage({ firestore, dailyCallLimit, now = Date.now }) {
  return {
    async reserve() {
      const day = new Date(now()).toISOString().slice(0, 10);
      const ref = firestore.collection('proxyUsage').doc(day);
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const calls = snapshot.exists ? snapshot.get('calls') : 0;
        if (calls >= dailyCallLimit) return false;
        transaction.set(ref, { calls: calls + 1 }, { merge: true });
        return true;
      });
    },
  };
}

module.exports = { makeDailyUsage };
