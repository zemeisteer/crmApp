// Topics and task types that IELTS prep sources report as current (checked
// November 2026). Used to steer a generated mock test when the live web
// search is not available. These are THEMES only: every text and question is
// written fresh by the AI, nothing is copied from the sources. Prep sites
// say themselves that no official topic list exists, so this is a guide to
// what is common, not a leak of exam content.

export const TREND_SOURCES = [
  { title: 'Cathoven: IELTS Speaking topics 2026', url: 'https://resources.cathoven.com/ielts-speaking/topics-2026' },
  { title: 'Cathoven: IELTS Writing Task 2 topics 2026', url: 'https://resources.cathoven.com/ielts-writing-task-2/topics-2026' },
  { title: 'IELTS Liz: essay topics for 2026', url: 'https://ieltsliz.com/ielts-essay-topics-for-2026/' },
  { title: 'Yocket: latest IELTS essay topics', url: 'https://prep.yocket.com/ielts/latest-ielts-essay-topics' },
  { title: 'BestMyTest: IELTS writing task 2 topics', url: 'https://www.bestmytest.com/ielts/writing-task-2-topics' },
  { title: 'Engnovate: academic listening forecast 2026', url: 'https://engnovate.com/ielts-exam-topics/ielts-academic-listening-forecast-q2-2026/' },
  { title: 'Collegedunia: IELTS listening topics', url: 'https://collegedunia.com/study-abroad/article/ielts-listening-topics' },
  { title: 'PW: IELTS reading topics', url: 'https://www.pw.live/study-abroad/ielts/exams/ielts-reading-topics' },
];

const LISTENING_1 = ['booking accommodation for a stay in a new city', 'enquiring about a gym or sports club membership', 'arranging a medical or dental appointment', 'registering for an evening course at a college', 'planning a weekend trip with a travel agent', 'renting equipment for a community event'];
const LISTENING_2 = ['a guided tour of a local heritage site', 'an announcement about changes at a public library', 'a talk about volunteering opportunities in the community', 'a radio feature on a new city park', 'a presentation about a workplace health programme'];
const LISTENING_3 = ['two students and a tutor discussing a group project on renewable energy', 'students planning a survey about social media use', 'a seminar discussion about a psychology experiment', 'students reviewing feedback on a business case study'];
const LISTENING_4 = ['a lecture on how cities are adapting to climate change', 'a lecture on artificial intelligence and jobs', 'a lecture on the history of a common material or invention', 'a lecture on animal behaviour and migration', 'a lecture on sleep, memory and learning'];

const READING = [
  'climate change and how coastal cities respond', 'ethical questions around artificial intelligence', 'cultural diversity and language preservation', 'the history of a major invention', 'urban planning and green spaces',
  'renewable energy and storage', 'how the brain learns and remembers', 'the economics of remote work', 'biodiversity and the loss of pollinators', 'the psychology of decision making',
];

const TASK1 = ['a line graph showing change over time in internet use by age group', 'a bar chart comparing energy sources between countries', 'a table of tourism figures over a decade', 'two pie charts on household spending in different years', 'a process diagram showing how recycled paper is made', 'two maps showing a town centre before and after development'];
const TASK1_GT = ['a letter to a landlord about a repair problem', 'a letter to a manager asking for time off to study', 'a letter to a friend inviting them to a local event', 'a letter of complaint about a delayed delivery'];
const TASK2 = [
  'whether governments should fund the arts or spend only on essential services (opinion essay)', 'whether technology in the classroom improves learning (discussion and opinion)', 'the advantages and disadvantages of remote work (advantages/disadvantages)',
  'why crime rates rise in cities and what can be done (problem/solution)', 'whether people should treat minor illnesses themselves instead of seeing a doctor (opinion essay)', 'the effect of globalisation and multinational companies on local cultures (discussion and opinion)',
  'whether university education should be free for everyone (opinion essay)', 'the role of social media in how young people communicate (two-part question)',
];

const SPEAKING_1 = ['hometown', 'work or studies', 'daily routine', 'free time and hobbies', 'food and cooking', 'technology and phones', 'transport', 'weather', 'friends', 'shopping', 'reading', 'music'];
const SPEAKING_2 = ['a person who has influenced you', 'an important decision you made', 'an interesting place you visited', 'a piece of technology you find useful', 'an achievement you are proud of', 'a memorable experience with a friend or family member'];
const SPEAKING_3 = ['how technology changes relationships', 'how education will change in the future', 'tourism and its effect on local places', 'role models in society', 'making big decisions: individual choice or advice'];

const pick = <T,>(list: T[], n: number): T[] => {
  const copy = [...list];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
};

// The same JSON the live search asks for (see generate-prompts.ts trendsPrompt).
export function bundledTrends(module: string) {
  const t1 = module === 'GENERAL' ? TASK1_GT : TASK1;
  return {
    listening: [pick(LISTENING_1, 1)[0], pick(LISTENING_2, 1)[0], pick(LISTENING_3, 1)[0], pick(LISTENING_4, 1)[0]],
    reading: pick(READING, 3),
    writing: { task1: pick(t1, 1)[0], task2: pick(TASK2, 1)[0] },
    speaking: { part1: pick(SPEAKING_1, 3), part2: pick(SPEAKING_2, 1)[0], part3: pick(SPEAKING_3, 1)[0] },
  };
}
