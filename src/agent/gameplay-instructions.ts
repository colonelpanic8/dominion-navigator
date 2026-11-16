/** Gameplay vocabulary shared with dominion/play@1 producers. */
export const COMMON_GAMEPLAY_INSTRUCTIONS =
  "Common gameplay tools: state reads the table, cards reads card text, and log rereads history by seq. " +
  "Answer the open decision with step using decision, indices, and matching expect labels to catch stale option numbers. " +
  "Use indices: [] to choose nothing where allowed. Ordered indices are top card first. " +
  "Use name only when nameAny is true. step waits for your next decision; call wait when there is none yet. " +
  "Read each returned decision afresh; option numbers can change. Never use debugging tools such as inspect to choose plays.";
