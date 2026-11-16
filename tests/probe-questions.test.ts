import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeGame } from "../src/probe/runtime-types";

const enumValue = (name: string, extra = {}) => ({ ...extra, toString: () => name });
const types = Object.fromEntries(["PLAY", "WAY", "DELAYED", "COMPLEX_AND", "COMPLEX_OR", "ORDER_CARDS"].map((name) => [name, enumValue(name)]));
const ids = { GAME_ACTION_PHASE: enumValue("GAME_ACTION_PHASE"), GOLD_MINE: enumValue("GOLD_MINE") };
const declines = { END_ACTIONS: enumValue("END_ACTIONS", { isEndButton: true }), DONT: enumValue("DONT") };
type Story = { questionId: object; prompt: string };
const sent: number[][] = [];

// Mirror the client's question-tree serialization, including OR branch selection.
class ClientQuestion {
  accumulatedAnswers: number[] = [];
  parentQuestion?: ClientComplexQuestion;
  constructor(readonly type: object, readonly story: Story) {}
  getAnswer(): number[] { return this.accumulatedAnswers; }
  send(): void {
    if (this.parentQuestion) {
      if (this.parentQuestion.type === types.COMPLEX_OR) this.parentQuestion.accumulatedAnswers = [this.parentQuestion.subquestions.indexOf(this)];
      this.parentQuestion.send();
    } else sent.push(this.getAnswer());
  }
  answer(value: unknown): void { assert.ok(typeof value === "number"); this.accumulatedAnswers = [value]; this.send(); }
  answerDecline(): void { this.accumulatedAnswers = []; this.send(); }
}
class CardElements {
  constructor(readonly elements: number[]) {}
}
class ClientChoiceQuestion extends ClientQuestion {
  min = 0;
  max = 1;
  constructor(type: object, story: Story, readonly content: CardElements, readonly declineButtonId = -1) { super(type, story); }
}
class ClientDelayedQuestion extends ClientQuestion {
  association = 2;
  declineButtonId = 0;
  override answerDecline(): void { this.accumulatedAnswers = [0]; this.send(); }
}
class ClientComplexQuestion extends ClientQuestion {
  constructor(type: object, story: Story, readonly subquestions: ClientQuestion[]) {
    super(type, story);
    for (const child of subquestions) child.parentQuestion = this;
  }
  override getAnswer(): number[] {
    if (this.type === types.COMPLEX_OR) {
      const branch = this.accumulatedAnswers[0]!;
      return [branch, ...this.subquestions[branch]!.getAnswer()];
    }
    return this.subquestions.flatMap((child) => { const answer = child.getAnswer(); return [answer.length, ...answer]; });
  }
}
Object.assign(globalThis, {
  window: {
    QuestionTypes: types, QuestionIds: ids, DeclineButtonIds: declines,
    ChoiceQuestion: ClientChoiceQuestion, ComplexQuestion: ClientComplexQuestion, DelayedQuestion: ClientDelayedQuestion,
    QuestionCardElements: CardElements,
    getByOrdinal: (values: Record<string, object>, ordinal: number) => Object.values(values)[ordinal],
    LANGUAGE: { getDeclineButtonText: { END_ACTIONS: "End Actions", DONT: "Don't" }, getDelayedQuestionButton: { GoldMine: "Gold & 4 Debt" } },
    LogLineParser: class { parseStory(story: Story) { return [{ text: story.prompt }]; } }
  }
});
const { answerDecision, openDecisions } = await import("../src/probe/questions");

function game() {
  sent.length = 0;
  const story = { questionId: ids.GAME_ACTION_PHASE, prompt: "You may play Actions" };
  const play = new ClientChoiceQuestion(types.PLAY!, story, new CardElements([0]), 0);
  const way = new ClientChoiceQuestion(types.WAY!, story, new CardElements([1]));
  const delayed = new ClientDelayedQuestion(types.DELAYED!, { questionId: ids.GOLD_MINE, prompt: "Gain a Gold and get 4 debt?" });
  const root = new ClientComplexQuestion(types.COMPLEX_OR!, story, [new ClientComplexQuestion(types.COMPLEX_AND!, story, [play, way]), delayed]);
  const runtime = {
    gameArea: {}, playerModel: { playerMe: { index: 0 } }, questionModel: { openQuestions: [root] },
    state: { cards: [{ id: 0, cardName: { name: "Swindler" } }, { id: 1, cardName: { name: "Way Of The Worm" } }, { id: 2, cardName: { name: "Gold Mine", toString: () => "GoldMine" } }] }
  } as unknown as RuntimeGame;
  return { runtime, play, way, delayed };
}

test("the probe rejects a Way alone before sending anything and sends its Action and Way together", () => {
  const { runtime, play, way } = game();
  const decision = openDecisions(runtime)[0]!.decision;
  assert.equal(answerDecision(runtime, decision.id, [2]).ok, false);
  assert.deepEqual(sent, []);
  assert.deepEqual(play.accumulatedAnswers, []);
  assert.deepEqual(way.accumulatedAnswers, []);
  assert.equal(answerDecision(runtime, decision.id, [0, 2]).ok, true);
  assert.deepEqual(sent, [[0, 1, 0, 1, 0]]);
});

test("Gold Mine offers acceptance while phase ending belongs to the play group; another Action skips the effect", () => {
  const { runtime, delayed } = game();
  const { decision, raw } = openDecisions(runtime)[0]!;
  assert.equal(raw.subquestions![1]!.declineEndsPhase, true);
  assert.deepEqual(decision.options.map((option) => option.label), ["Swindler", "End Actions", "Way Of The Worm", "Gold & 4 Debt"]);
  assert.equal(answerDecision(runtime, decision.id, [0]).ok, true);
  assert.deepEqual(sent, [[0, 1, 0, 0]]);
  assert.deepEqual(delayed.accumulatedAnswers, []);
});

test("explicit End Actions and accepting Gold Mine still send their distinct client answers", () => {
  const { runtime } = game();
  const { decision } = openDecisions(runtime)[0]!;
  assert.equal(answerDecision(runtime, decision.id, [1]).ok, true);
  assert.deepEqual(sent, [[0, 0, 0]]);
  sent.length = 0;
  assert.equal(answerDecision(runtime, decision.id, [3]).ok, true);
  assert.deepEqual(sent, [[1, 1]]);
});

test("an earlier client Way selection cannot leak into an Action answered without a Way", () => {
  const { runtime, way } = game();
  way.accumulatedAnswers = [0];
  const { decision } = openDecisions(runtime)[0]!;
  assert.equal(answerDecision(runtime, decision.id, [0]).ok, true);
  assert.deepEqual(sent, [[0, 1, 0, 0]]);
  assert.deepEqual(way.accumulatedAnswers, []);
});

test("keeping the current order preserves the client's original accumulated answer", () => {
  const { runtime } = game();
  const question = new ClientChoiceQuestion(types.ORDER_CARDS!, { questionId: ids.GAME_ACTION_PHASE, prompt: "Order cards" }, new CardElements([0, 1]));
  question.min = question.max = 2;
  question.accumulatedAnswers = [1, 0];
  runtime.questionModel!.openQuestions = [question];
  const { decision } = openDecisions(runtime)[0]!;
  assert.equal(answerDecision(runtime, decision.id, [2]).ok, true);
  assert.deepEqual(sent, [[1, 0]]);
});
