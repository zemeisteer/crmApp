// A short sample IELTS mock (original texts) so a center can try the
// platform at once: Listening is read aloud by the browser until real
// recordings are uploaded. Centers edit or replace every part.

const fill = (prompt: string, answer: string) => ({ type: 'FILL_BLANK', prompt, correctAnswer: answer });
const mcq = (prompt: string, options: string[], answer: string) => ({ type: 'MCQ', prompt, options, correctAnswer: answer });
const tfng = (prompt: string, answer: 'true' | 'false' | 'ng') => ({ type: 'TRUE_FALSE_NG', prompt, correctAnswer: answer });
const headings = (pairs: Array<[string, string]>, extra: string[]) => ({
  type: 'MATCHING',
  prompt: 'Choose the correct heading for each paragraph from the list of headings.',
  instruction: 'Questions 9-12. The reading passage has four paragraphs, A-D. Choose the correct heading for each paragraph.',
  pairs: pairs.map(([left, right]) => ({ left, right })),
  extra,
});

export const SAMPLE_IELTS = {
  title: 'IELTS Academic — namuna mock test',
  content: {
    listening: {
      durationMin: 30,
      parts: [
        {
          title: 'Part 1',
          instruction: 'Complete the form. Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.',
          audioPath: null,
          transcript:
            "Good morning, Riverside Sports Centre, how can I help you? Hello, I'd like to join the swimming club. Of course. Can I have your name, please? It's Daniel Carter. Carter, C-A-R-T-E-R. Thank you. And your address? 42 Hill Road. And a phone number? Oh seven seven, four five, double nine, one two. Thank you. Which membership would you like, standard or premium? Standard, please. That's twenty-five pounds a month. When would you like to start? Next Monday, the fourth of March. And how did you hear about us? A friend told me. Lovely. Please bring a passport photo when you come.",
          questions: [
            fill('Surname: ______', 'Carter'),
            fill('Address: ______ Hill Road', '42'),
            fill('Membership type: ______', 'standard'),
            fill('Monthly fee: £______', '25|twenty-five|twenty five'),
            fill('Start date: Monday, ______ March', '4th|4|fourth|(the) fourth'),
            mcq('How did Daniel hear about the club?', ['From an advertisement', 'From a friend', 'On the internet'], 'B'),
            fill('He must bring a ______ photo.', 'passport'),
          ],
        },
        {
          title: 'Part 2',
          instruction: 'Choose the correct letter, A, B or C.',
          audioPath: null,
          transcript:
            "Welcome to the city museum. My name is Laura and I'll be your guide today. The museum opened in 1998 in what used to be a railway station. Our most popular gallery is the one on the second floor, which shows the history of the city's textile industry. The café is on the ground floor, next to the gift shop, and it closes at four thirty, half an hour before the museum itself. Photography is allowed everywhere except in the special exhibition on the top floor. The tour will last about ninety minutes.",
          questions: [
            mcq('The museum building was originally', ['a factory', 'a railway station', 'a school'], 'B'),
            mcq('The most popular gallery is about', ['the textile industry', 'the railway', 'modern art'], 'A'),
            mcq('The café closes at', ['4:00', '4:30', '5:00'], 'B'),
            mcq('Photography is NOT allowed', ['on the ground floor', 'on the second floor', 'on the top floor'], 'C'),
            fill('The tour lasts about ______ minutes.', '90|ninety'),
          ],
        },
      ],
    },
    reading: {
      durationMin: 60,
      passages: [
        {
          title: 'Passage 1 — The return of the urban bee',
          text:
            "A  For most of the twentieth century, beekeeping was seen as a country activity. Hives needed space, and the fields of the countryside offered the flowers that bees depend on. In recent decades, however, a growing number of beekeepers have moved their hives into cities.\n\n" +
            "B  The reasons are partly practical. Modern farms often grow a single crop over large areas, which provides food for bees for only a few weeks each year. City parks, gardens and even balconies, by contrast, contain a wide variety of plants that flower at different times, offering a longer season. Some studies have found that urban hives produce more honey than rural ones, although researchers warn that results vary greatly from city to city.\n\n" +
            "C  Pesticides are another factor. In many towns, the use of chemicals in public parks has been reduced or banned, while farms continue to rely on them. Bees exposed to certain pesticides can become disoriented and fail to return to the hive.\n\n" +
            "D  Not everyone welcomes the trend. Ecologists point out that honeybees compete with wild bees for the same flowers. If too many hives are placed in a small area, wild species, many of which are already in decline, may suffer. For this reason, some cities now ask beekeepers to register their hives, and a few have set a limit on the number allowed in each district.",
          questions: [
            tfng('Beekeeping was mainly associated with rural areas in the twentieth century.', 'true'),
            tfng('Single-crop farms offer bees food throughout the year.', 'false'),
            tfng('All studies show that city hives produce more honey than country hives.', 'false'),
            tfng('Some towns have banned pesticides in public parks.', 'true'),
            tfng('Urban beekeepers earn more money than rural beekeepers.', 'ng'),
            fill('Bees affected by some pesticides may not ______ to the hive.', 'return'),
            fill('Honeybees compete with ______ bees for flowers.', 'wild'),
            mcq('What have some cities done in response to the trend?', ['Banned beekeeping completely', 'Asked beekeepers to register their hives', 'Paid beekeepers to move to the countryside', 'Planted fewer flowers'], 'B'),
            headings(
              [
                ['Paragraph A', 'A move from the country to the town'],
                ['Paragraph B', 'Why cities can suit bees'],
                ['Paragraph C', 'The effect of chemicals'],
                ['Paragraph D', 'A possible cost to other insects'],
              ],
              ['The history of honey in cooking', 'How to become a beekeeper', 'Bees and climate change'],
            ),
          ],
        },
      ],
    },
    writing: {
      durationMin: 60,
      tasks: [
        {
          title: 'Task 1',
          prompt:
            'The table below shows the percentage of households with internet access in three countries in 2005, 2010 and 2015.\n\nCountry A: 35%, 58%, 82%\nCountry B: 60%, 71%, 88%\nCountry C: 12%, 30%, 64%\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.',
          minWords: 150,
        },
        {
          title: 'Task 2',
          prompt:
            'Some people believe that university education should be free for all students. Others think students should pay for their own studies.\n\nDiscuss both views and give your own opinion. Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.',
          minWords: 250,
        },
      ],
    },
    speaking: {
      parts: [
        {
          title: 'Part 1 — Introduction',
          instruction: 'Answer each question in 2-3 sentences.',
          prepSeconds: 0,
          answerSeconds: 40,
          questions: ['Do you work or are you a student?', 'What do you like most about your hometown?', 'How often do you read books? Why?', 'Do you prefer mornings or evenings? Why?'],
        },
        {
          title: 'Part 2 — Cue card',
          instruction: 'You have 1 minute to prepare. Then speak for 1-2 minutes.',
          prepSeconds: 60,
          answerSeconds: 120,
          questions: ['Describe a skill you learned that you think is useful. You should say: what the skill is, when and how you learned it, how often you use it, and explain why you think it is useful.'],
        },
        {
          title: 'Part 3 — Discussion',
          instruction: 'Give longer answers with reasons and examples.',
          prepSeconds: 0,
          answerSeconds: 60,
          questions: ['Which skills do you think young people should learn at school?', 'Is it better to learn a skill from a teacher or from the internet?', 'How might the skills people need change in the future?'],
        },
      ],
    },
  },
};
