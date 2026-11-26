// Tracks Gemini spend per UTC day in Firestore, so the daily budget survives restarts and deploys.
// Clients cannot read or write this collection: firestore.rules only opens /scores.
// Spend is estimated from the token counts Gemini reports, at the list prices passed in. When the
// counts are missing (a timeout, or a response without usage), the worst case is recorded instead.
const WORST_CASE_USAGE = { promptTokenCount: 800, candidatesTokenCount: 300, thoughtsTokenCount: 300 };

function makeDailyUsage({ firestore, dailyBudgetUsd, inputUsdPerMillionTokens, outputUsdPerMillionTokens, now = Date.now, log = () => {} }) {
  let exhaustedDay = null;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const ref = (day) => firestore.collection('proxyUsage').doc(day);

  return {
    // True if today's budget has room for another call. Spend is recorded after Gemini answers, so calls
    // already in flight (up to the service's concurrency, 20) can overshoot the budget by a few percent.
    async hasBudget() {
      const day = today();
      if (exhaustedDay === day) return false;
      const snapshot = await ref(day).get();
      const spent = snapshot.exists ? snapshot.get('usd') : 0;
      if (spent >= dailyBudgetUsd) {
        exhaustedDay = day;
        return false;
      }
      return true;
    },
    async record(reported) {
      let usage = reported;
      if (!usage || typeof usage.promptTokenCount !== 'number') {
        log('warning', 'no token counts from Gemini, recording the worst case', { reported });
        usage = WORST_CASE_USAGE;
      }
      const input = usage.promptTokenCount;
      // Thinking tokens bill as output.
      const output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
      const usd = (input * inputUsdPerMillionTokens + output * outputUsdPerMillionTokens) / 1e6;
      const day = today();
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref(day));
        const data = snapshot.exists ? snapshot.data() : { usd: 0, calls: 0 };
        transaction.set(ref(day), { usd: data.usd + usd, calls: data.calls + 1 });
      });
      return usd;
    },
  };
}

module.exports = { makeDailyUsage, WORST_CASE_USAGE };
