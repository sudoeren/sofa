import type { JsonValue, ToolState } from "@sofa/shared";

/**
 * Ready-made spaces offered on the landing page. Creating one copies its tools, their
 * state and its materials into a new space. Members are fictional (ids start with "ex-").
 * Every config passes its widget's schema and every state key is one the widget documents.
 */

export type ExampleTool = {
  widgetType: string;
  title: string;
  description: string;
  config: JsonValue;
  state: ToolState;
  span?: 1 | 2;
};

export type ExampleMaterial = {
  kind: "note" | "link";
  text?: string;
  url?: string;
  title?: string;
};

export type ExampleMember = { id: string; name: string };

export type ExampleSpace = {
  id: string;
  title: string;
  description: string;
  /** fictional member shown as the author of the materials */
  author: ExampleMember;
  tools: ExampleTool[];
  materials?: ExampleMaterial[];
};

const ADA = { id: "ex-ada", name: "Ada" };
const TOMAS = { id: "ex-tomas", name: "Tomas" };
const PRIYA = { id: "ex-priya", name: "Priya" };
const KENJI = { id: "ex-kenji", name: "Kenji" };
const LEA = { id: "ex-lea", name: "Lea" };
const SAM = { id: "ex-sam", name: "Sam" };
const NORA = { id: "ex-nora", name: "Nora" };
const OMAR = { id: "ex-omar", name: "Omar" };

/** a fixed moment the example timestamps count from (ms) */
const T0 = Date.UTC(2026, 9, 20, 18, 0);
const at = (minutes: number) => T0 + minutes * 60_000;

function vote(member: ExampleMember, choices: string[], minutes: number): JsonValue {
  return { name: member.name, choices, at: at(minutes) };
}

const lisbon: ExampleSpace = {
  id: "lisbon-weekend",
  title: "Weekend in Lisbon",
  description: "Four friends plan three days: the itinerary, shared costs, packing and dinner.",
  author: ADA,
  materials: [
    {
      kind: "note",
      text: "Flights: TP 1351 out on Friday 07:55, back on Sunday 19:40. Apartment in Alfama, check-in from 14:00, the key box code is in the booking mail.",
    },
    {
      kind: "link",
      url: "https://en.wikipedia.org/wiki/Alfama",
      title: "Alfama",
      text: "Where we are staying: the oldest district, lots of stairs.",
    },
    {
      kind: "note",
      text: "Tomas cannot do seafood. Priya wants one proper fado evening.",
    },
  ],
  tools: [
    {
      widgetType: "itinerary",
      title: "Lisbon plan",
      description: "Three days, roughly. Mark what is booked and say which stops you are joining.",
      span: 2,
      config: {
        allowAdd: true,
        days: [
          { id: "fri", label: "Friday", date: "2027-03-12" },
          { id: "sat", label: "Saturday", date: "2027-03-13" },
          { id: "sun", label: "Sunday", date: "2027-03-14" },
        ],
        stops: [
          {
            id: "land",
            dayId: "fri",
            time: "10:30",
            title: "Land and take the metro into town",
            place: "Airport, red line",
          },
          {
            id: "checkin",
            dayId: "fri",
            time: "14:00",
            title: "Check in at the apartment",
            place: "Alfama",
          },
          {
            id: "viewpoint",
            dayId: "fri",
            time: "17:30",
            title: "Sunset at the Santa Luzia viewpoint",
          },
          {
            id: "fado",
            dayId: "fri",
            time: "21:00",
            title: "Fado evening",
            place: "Small place near the cathedral",
            note: "Booked for four, pay at the door.",
          },
          { id: "tram", dayId: "sat", time: "09:30", title: "Tram 28 across the old town" },
          {
            id: "belem",
            dayId: "sat",
            time: "12:00",
            title: "Belem tower and custard tarts",
            place: "Belem",
          },
          {
            id: "lxf",
            dayId: "sat",
            time: "16:00",
            title: "Browse the old factory market",
            place: "Alcantara",
          },
          {
            id: "beach",
            dayId: "sun",
            time: "10:00",
            title: "Train to the beach in Cascais",
            note: "Trains every 20 minutes from Cais do Sodre.",
          },
          { id: "airport", dayId: "sun", time: "17:00", title: "Back to the airport" },
        ],
      },
      state: {
        "booked:fado": true,
        "booked:checkin": true,
        "going:fado:ex-ada": { name: ADA.name },
        "going:fado:ex-priya": { name: PRIYA.name },
        "going:fado:ex-kenji": { name: KENJI.name },
        "going:beach:ex-tomas": { name: TOMAS.name },
        "going:beach:ex-ada": { name: ADA.name },
        "stop:dinner-sat": {
          dayId: "sat",
          time: "20:30",
          title: "Dinner (see the poll)",
          note: "",
          place: "",
          link: "",
          order: 10,
        },
      },
    },
    {
      widgetType: "expenses",
      title: "Trip costs",
      description: "Add what you paid; balances and who pays whom update on their own.",
      config: {
        currency: "EUR",
        people: [ADA, TOMAS, PRIYA, KENJI],
        expenses: [
          { id: "flat", title: "Apartment, two nights", amount: 312, paidBy: "ex-ada" },
          { id: "fado", title: "Fado evening deposit", amount: 80, paidBy: "ex-priya" },
          {
            id: "metro",
            title: "Metro cards",
            amount: 27.6,
            paidBy: "ex-kenji",
          },
        ],
      },
      state: {
        "expense:tarts": {
          title: "Custard tarts and coffee",
          amount: 18.4,
          paidBy: "ex-tomas",
          splitBetween: null,
          order: 1,
        },
        "expense:train": {
          title: "Cascais train tickets",
          amount: 9.2,
          paidBy: "ex-ada",
          splitBetween: ["ex-ada", "ex-tomas"],
          order: 2,
        },
      },
    },
    {
      widgetType: "checklist",
      title: "Before we fly",
      description: "Claim what you take care of.",
      config: {
        assignable: true,
        showProgress: true,
        items: [
          { id: "checkin", text: "Online check-in for everyone", section: "Travel" },
          { id: "ids", text: "Passports or ID cards", section: "Travel" },
          {
            id: "adapter",
            text: "Plug adapters for anyone coming from outside the EU",
            section: "Travel",
          },
          { id: "shoes", text: "Comfortable shoes for the hills", section: "Packing" },
          { id: "swim", text: "Swimwear for Cascais", section: "Packing" },
          { id: "cash", text: "Some cash for small places", section: "Money" },
        ],
      },
      state: {
        "done:checkin": { by: "ex-ada", name: ADA.name, at: at(30) },
        "claim:checkin": { id: "ex-ada", name: ADA.name },
        "claim:cash": { id: "ex-kenji", name: KENJI.name },
        "done:ids": { by: "ex-priya", name: PRIYA.name, at: at(45) },
        "item:sunscreen": {
          text: "Sunscreen, it is sunny already",
          section: "Packing",
          createdAt: at(50),
          by: "ex-tomas",
        },
      },
    },
    {
      widgetType: "poll",
      title: "Saturday dinner",
      description: "Where do we eat on Saturday night?",
      config: {
        question: "Where should we eat on Saturday?",
        options: [
          { id: "grill", label: "Grilled chicken place in Bairro Alto" },
          { id: "tasca", label: "Family-run tasca with daily specials" },
          { id: "market", label: "Food hall at the river" },
        ],
        multiple: false,
        allowAdd: true,
        anonymous: false,
        showResults: "always",
      },
      state: {
        "vote:ex-ada": vote(ADA, ["tasca"], 60),
        "vote:ex-tomas": vote(TOMAS, ["grill"], 62),
        "vote:ex-priya": vote(PRIYA, ["tasca"], 70),
      },
    },
  ],
};

const dinner: ExampleSpace = {
  id: "dinner-party",
  title: "Dinner party",
  description: "Pick an evening, sign up for dishes and sort out who sits where.",
  author: NORA,
  materials: [
    {
      kind: "note",
      text: "We have room for ten at the long table and four in the kitchen. Two vegetarians, one nut allergy (Omar).",
    },
  ],
  tools: [
    {
      widgetType: "availability",
      title: "Which evening?",
      description: "Mark the evenings you can make; the best one is highlighted.",
      config: {
        prompt: "When can you come for dinner?",
        slots: [
          { id: "fri-4", label: "Fri 4 Dec, 19:30" },
          { id: "sat-5", label: "Sat 5 Dec, 19:30" },
          { id: "fri-11", label: "Fri 11 Dec, 19:30" },
          { id: "sat-12", label: "Sat 12 Dec, 19:30" },
        ],
        allowMaybe: true,
        allowAdd: true,
      },
      state: {
        "who:ex-nora": { name: NORA.name },
        "who:ex-omar": { name: OMAR.name },
        "who:ex-lea": { name: LEA.name },
        "who:ex-sam": { name: SAM.name },
        "answer:ex-nora:fri-4": "no",
        "answer:ex-nora:sat-5": "yes",
        "answer:ex-nora:fri-11": "yes",
        "answer:ex-nora:sat-12": "maybe",
        "answer:ex-omar:fri-4": "yes",
        "answer:ex-omar:sat-5": "yes",
        "answer:ex-omar:sat-12": "no",
        "answer:ex-lea:sat-5": "maybe",
        "answer:ex-lea:fri-11": "yes",
        "answer:ex-lea:sat-12": "yes",
        "answer:ex-sam:fri-4": "no",
        "answer:ex-sam:sat-5": "yes",
        "answer:ex-sam:fri-11": "no",
      },
    },
    {
      widgetType: "table",
      title: "Who brings what",
      description: "Sign up for a dish so we do not end up with four desserts.",
      span: 2,
      config: {
        columns: [
          { id: "dish", label: "Dish", type: "text" },
          {
            id: "course",
            label: "Course",
            type: "select",
            options: ["Starter", "Main", "Side", "Dessert", "Drinks"],
          },
          { id: "who", label: "Who", type: "member" },
          { id: "veg", label: "Vegetarian", type: "checkbox" },
        ],
        rows: [
          { id: "r1", cells: { dish: "Roasted pumpkin soup", course: "Starter", veg: true } },
          { id: "r2", cells: { dish: "Slow-cooked lamb", course: "Main", veg: false } },
          { id: "r3", cells: { dish: "Mushroom risotto", course: "Main", veg: true } },
          { id: "r4", cells: { course: "Side" } },
          { id: "r5", cells: { course: "Dessert" } },
          { id: "r6", cells: { dish: "Wine and sparkling water", course: "Drinks" } },
        ],
        allowAddRows: true,
        allowAddColumns: false,
        summary: "none",
      },
      state: {
        "cell:r1:who": { id: "ex-lea", name: LEA.name },
        "cell:r2:who": { id: "ex-nora", name: NORA.name },
        "cell:r3:who": { id: "ex-sam", name: SAM.name },
        "cell:r5:dish": "Apple tart, nut-free",
        "cell:r5:who": { id: "ex-omar", name: OMAR.name },
        "cell:r5:veg": true,
      },
    },
    {
      widgetType: "seating",
      title: "Seating",
      description: "Drag guests to a table, or tap a guest and then a table.",
      config: {
        allowAdd: true,
        tables: [
          { id: "long", name: "Long table", seats: 10 },
          { id: "kitchen", name: "Kitchen table", seats: 4 },
        ],
        guests: [
          { id: "nora", name: "Nora" },
          { id: "omar", name: "Omar" },
          { id: "lea", name: "Lea" },
          { id: "sam", name: "Sam" },
          { id: "ines", name: "Ines" },
          { id: "felix", name: "Felix" },
          { id: "mei", name: "Mei" },
          { id: "jonah", name: "Jonah" },
          { id: "amara", name: "Amara" },
          { id: "luca", name: "Luca" },
        ],
      },
      state: {
        "seat:nora": "long",
        "seat:omar": "long",
        "seat:lea": "long",
        "seat:ines": "long",
        "seat:mei": "kitchen",
        "seat:jonah": "kitchen",
      },
    },
  ],
};

const gameNight: ExampleSpace = {
  id: "office-game-night",
  title: "Office game night",
  description: "A table tennis cup with live results and a vote on the board game.",
  author: KENJI,
  materials: [
    {
      kind: "note",
      text: "Thursday after work in the big meeting room. Pizza arrives at 18:30, the cup starts at 19:00.",
    },
  ],
  tools: [
    {
      widgetType: "bracket",
      title: "Table tennis cup",
      description: "Tap the winner of each match, or type the score.",
      span: 2,
      config: {
        title: "Table tennis cup",
        bestOf: 3,
        thirdPlace: true,
        participants: [
          { id: "kenji", name: "Kenji" },
          { id: "priya", name: "Priya" },
          { id: "lea", name: "Lea" },
          { id: "tomas", name: "Tomas" },
          { id: "amara", name: "Amara" },
          { id: "felix", name: "Felix" },
          { id: "mei", name: "Mei" },
          { id: "omar", name: "Omar" },
        ],
      },
      // Seeding for 8: r1m1 1-8, r1m2 4-5, r1m3 2-7, r1m4 3-6.
      state: {
        "score:r1m1": { a: "kenji", b: "omar", scoreA: 2, scoreB: 1, winner: "a" },
        "score:r1m2": { a: "tomas", b: "amara", scoreA: 0, scoreB: 2, winner: "b" },
        "score:r1m3": { a: "priya", b: "mei", scoreA: 2, scoreB: 0, winner: "a" },
        "score:r1m4": { a: "lea", b: "felix", scoreA: 1, scoreB: 2, winner: "b" },
        "score:r2m1": { a: "kenji", b: "amara", scoreA: 1, scoreB: 2, winner: "b" },
      },
    },
    {
      widgetType: "poll",
      title: "Which board game?",
      description: "Pick up to two; the winner comes out after the cup.",
      config: {
        question: "What do we play after the cup?",
        options: [
          { id: "codes", label: "A word guessing game in two teams" },
          { id: "trains", label: "Building train routes across a map" },
          { id: "werewolf", label: "Hidden roles in a village" },
          { id: "trivia", label: "Pub quiz, three rounds" },
        ],
        multiple: true,
        allowAdd: true,
        anonymous: false,
        showResults: "always",
      },
      state: {
        "vote:ex-kenji": vote(KENJI, ["codes", "werewolf"], 10),
        "vote:ex-priya": vote(PRIYA, ["codes"], 12),
        "vote:ex-lea": vote(LEA, ["trains", "trivia"], 20),
        "vote:ex-omar": vote(OMAR, ["werewolf"], 25),
      },
    },
    {
      widgetType: "checklist",
      title: "Setup",
      description: "Who brings and prepares what.",
      config: {
        assignable: true,
        showProgress: true,
        items: [
          { id: "pizza", text: "Order pizza for 12" },
          { id: "net", text: "Borrow a second net and paddles" },
          { id: "games", text: "Bring the board games" },
          { id: "drinks", text: "Drinks from the shop downstairs" },
        ],
      },
      state: {
        "claim:pizza": { id: "ex-kenji", name: KENJI.name },
        "done:pizza": { by: "ex-kenji", name: KENJI.name, at: at(5) },
        "claim:games": { id: "ex-lea", name: LEA.name },
      },
    },
  ],
};

export const EXAMPLES: ExampleSpace[] = [lisbon, dinner, gameNight];

export function getExample(id: string): ExampleSpace | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
