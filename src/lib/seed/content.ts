import type { Category } from '@/lib/types';

export interface SeedCreator {
  username: string;
  display_name: string;
  bio: string;
  location: string;
  interests: Category[];
  category: Category;
  joinedDaysAgo: number;
  /** Rough audience size used when generating followers. 1 = brand new. */
  pull: number;
  posts: { caption: string; tags: string[]; daysAgo: number }[];
}

/**
 * Hand written sample creators. These exist so a brand new install feels like a
 * real community: a mix of people with a few hundred followers and people who
 * literally started yesterday.
 */
export const SEED_CREATORS: SeedCreator[] = [
  {
    username: 'tommy',
    display_name: 'Tommy',
    bio: 'Trying to build something people remember.',
    location: 'Columbus, OH',
    interests: ['Life', 'Gaming', 'Music'],
    category: 'Gaming',
    joinedDaysAgo: 98,
    pull: 11,
    posts: [
      { caption: 'Been editing this clip for 3 days. One shot, no cuts.', tags: ['gaming', 'clips'], daysAgo: 2 },
      { caption: 'made a beat at 2am and it might be the best thing I have ever done', tags: ['music', 'beats'], daysAgo: 5 },
      { caption: 'Setup finally finished. Two years of saving.', tags: ['setup', 'gaming'], daysAgo: 11 },
      { caption: 'first video ever. be nice.', tags: ['firstpost'], daysAgo: 24 },
    ],
  },
  {
    username: 'novaplays',
    display_name: 'Nova',
    bio: 'Ranked grinder. Clip collector. I stream when the wifi behaves.',
    location: 'Manchester, UK',
    interests: ['Gaming', 'Life'],
    category: 'Gaming',
    joinedDaysAgo: 140,
    pull: 9,
    posts: [
      { caption: '1v4 clutch. I have never screamed louder.', tags: ['clutch', 'gaming'], daysAgo: 1 },
      { caption: 'How I actually aim — no mouse settings gatekeeping.', tags: ['tutorial'], daysAgo: 6 },
      { caption: 'Day 40 of grinding. Sleep is a concept.', tags: ['grind'], daysAgo: 13 },
    ],
  },
  {
    username: 'mirabeats',
    display_name: 'Mira',
    bio: 'Bedroom producer. 17. Everything you hear was made on a laptop.',
    location: 'Lagos, NG',
    interests: ['Music', 'Life'],
    category: 'Music',
    joinedDaysAgo: 12,
    pull: 3,
    posts: [
      { caption: 'made this at 2am on a laptop that barely runs. 40 seconds.', tags: ['music', 'producer'], daysAgo: 1 },
      { caption: 'made this from a voice note my mum sent me', tags: ['music', 'sample'], daysAgo: 4 },
      { caption: 'chords that make my chest hurt, volume 3', tags: ['music'], daysAgo: 9 },
    ],
  },
  {
    username: 'deekay',
    display_name: 'Dee K',
    bio: 'Stand up. Bad ideas, said confidently.',
    location: 'Chicago, IL',
    interests: ['Comedy', 'Life'],
    category: 'Comedy',
    joinedDaysAgo: 110,
    pull: 7,
    posts: [
      { caption: 'Told this joke to 6 people last night. It worked on 5.', tags: ['standup'], daysAgo: 2 },
      { caption: 'my landlord is an unpaid comedy writer', tags: ['comedy'], daysAgo: 8 },
      { caption: 'open mic #31. they laughed. I cried after. balance.', tags: ['openmic'], daysAgo: 17 },
    ],
  },
  {
    username: 'saintlifts',
    display_name: 'Saint',
    bio: 'Natural. 4 years in. Documenting the whole thing.',
    location: 'Toronto, CA',
    interests: ['Fitness', 'Sports'],
    category: 'Fitness',
    joinedDaysAgo: 185,
    pull: 11,
    posts: [
      { caption: 'Week 12. Same shirt, different guy.', tags: ['transformation'], daysAgo: 3 },
      { caption: 'stop program hopping. that is the whole post.', tags: ['fitness'], daysAgo: 7 },
      { caption: '5am is not a personality but it is my personality', tags: ['gym'], daysAgo: 19 },
    ],
  },
  {
    username: 'inkbyrae',
    display_name: 'Rae',
    bio: 'Ink and ruined sleep schedules. Commissions sometimes open.',
    location: 'Lisbon, PT',
    interests: ['Art', 'Life'],
    category: 'Art',
    joinedDaysAgo: 100,
    pull: 6,
    posts: [
      { caption: '9 hours on one hand. Hands are evil.', tags: ['art', 'drawing'], daysAgo: 1 },
      { caption: 'first page of something bigger', tags: ['comic', 'art'], daysAgo: 6 },
      { caption: 'I redrew my first ever post. 8 months apart.', tags: ['progress'], daysAgo: 15 },
    ],
  },
  {
    username: 'kofibuilds',
    display_name: 'Kofi',
    bio: 'Building a sneaker cleaning business from my mum’s garage.',
    location: 'Accra, GH',
    interests: ['Business', 'Fashion'],
    category: 'Business',
    joinedDaysAgo: 21,
    pull: 4,
    posts: [
      { caption: 'Customer 18. I still get nervous every single time.', tags: ['business', 'smallbusiness'], daysAgo: 2 },
      { caption: 'cleaned these for a customer and honestly I am proud of them', tags: ['smallbusiness'], daysAgo: 5 },
      { caption: 'made £62 this week. reinvested all of it.', tags: ['hustle'], daysAgo: 12 },
    ],
  },
  {
    username: 'lunashoots',
    display_name: 'Luna',
    bio: 'Film photos of strangers who said yes.',
    location: 'Seoul, KR',
    interests: ['Photography', 'Art'],
    category: 'Photography',
    joinedDaysAgo: 125,
    pull: 8,
    posts: [
      { caption: 'Shot on a camera older than me.', tags: ['film', 'photography'], daysAgo: 3 },
      { caption: 'asked 40 people. 6 said yes. here are the 6.', tags: ['portraits'], daysAgo: 10 },
    ],
  },
  {
    username: 'jaydribble',
    display_name: 'Jay',
    bio: '6ft guard. Undersized, unbothered. Highlights + footwork drills.',
    location: 'Houston, TX',
    interests: ['Sports', 'Life'],
    category: 'Sports',
    joinedDaysAgo: 96,
    pull: 6,
    posts: [
      { caption: 'Crossover I have been drilling since June, in a real game.', tags: ['basketball'], daysAgo: 2 },
      { caption: 'no highlight tape yet. just work.', tags: ['hoops'], daysAgo: 9 },
    ],
  },
  {
    username: 'pastrypia',
    display_name: 'Pia',
    bio: 'Croissants at 4am. Culinary school dropout, kitchen lifer.',
    location: 'Mexico City, MX',
    interests: ['Food', 'Life'],
    category: 'Food',
    joinedDaysAgo: 17,
    pull: 4,
    posts: [
      { caption: '72 hour dough. Worth every minute of lost sleep.', tags: ['baking', 'food'], daysAgo: 1 },
      { caption: 'my first batch vs my 300th batch', tags: ['progress', 'food'], daysAgo: 8 },
    ],
  },
  {
    username: 'theoloops',
    display_name: 'Theo',
    bio: 'Guitar loops, no talking, no face. Just the sound.',
    location: 'Berlin, DE',
    interests: ['Music'],
    category: 'Music',
    joinedDaysAgo: 8,
    pull: 2,
    posts: [
      { caption: 'Day 8 on here. 4 followers. Still posting.', tags: ['guitar'], daysAgo: 1 },
      { caption: 'loop I cannot stop playing', tags: ['music'], daysAgo: 4 },
    ],
  },
  {
    username: 'zaracodes',
    display_name: 'Zara',
    bio: 'Teaching myself to build apps in public. Currently: very bad at CSS.',
    location: 'Karachi, PK',
    interests: ['Education', 'Business'],
    category: 'Technology',
    joinedDaysAgo: 115,
    pull: 5,
    posts: [
      { caption: 'Shipped something today that 3 people used. Best day this month.', tags: ['buildinpublic'], daysAgo: 2 },
      { caption: 'learning in public means being wrong in public. ok.', tags: ['coding'], daysAgo: 11 },
    ],
  },
  {
    username: 'milesfits',
    display_name: 'Miles',
    bio: 'Thrifted fits, £0 budget, way too much confidence.',
    location: 'London, UK',
    interests: ['Fashion', 'Life'],
    category: 'Fashion',
    joinedDaysAgo: 92,
    pull: 5,
    posts: [
      { caption: 'Whole fit: £14. Fight me.', tags: ['thrift', 'fashion'], daysAgo: 3 },
      { caption: 'charity shop haul, be honest about #3', tags: ['fashion'], daysAgo: 13 },
    ],
  },
  {
    username: 'amaraacts',
    display_name: 'Amara',
    bio: 'Actor. Self tapes in a closet with a ring light and a dream.',
    location: 'Atlanta, GA',
    interests: ['Life'],
    category: 'Other',
    joinedDaysAgo: 15,
    pull: 3,
    posts: [
      { caption: 'Monologue take 41. This one felt different.', tags: ['acting'], daysAgo: 2 },
      { caption: '19 auditions. 0 callbacks. posting anyway.', tags: ['actor'], daysAgo: 7 },
    ],
  },
  {
    username: 'benchpressbea',
    display_name: 'Bea',
    bio: 'Powerlifting coach in training. Numbers go up slowly. That is fine.',
    location: 'Melbourne, AU',
    interests: ['Fitness', 'Sports', 'Education'],
    category: 'Fitness',
    joinedDaysAgo: 150,
    pull: 9,
    posts: [
      { caption: 'PR at 6am with nobody watching. Posting it so somebody does.', tags: ['powerlifting'], daysAgo: 4 },
      { caption: 'form check thread — send yours', tags: ['coaching'], daysAgo: 14 },
    ],
  },
  {
    username: 'okaywren',
    display_name: 'Wren',
    bio: 'Sketch comedy with my two flatmates and one tripod.',
    location: 'Dublin, IE',
    interests: ['Comedy', 'Life'],
    category: 'Comedy',
    joinedDaysAgo: 88,
    pull: 4,
    posts: [
      { caption: 'We filmed this in a stairwell. Sound guy: nobody.', tags: ['sketch'], daysAgo: 1 },
      { caption: 'the flatmate cinematic universe continues', tags: ['comedy'], daysAgo: 9 },
    ],
  },
  {
    username: 'ridgeruns',
    display_name: 'Ridge',
    bio: 'Marathon #1 in April. Currently slow and honest about it.',
    location: 'Denver, CO',
    interests: ['Sports', 'Fitness'],
    category: 'Sports',
    joinedDaysAgo: 120,
    pull: 6,
    posts: [
      { caption: '18 miles. Cried at mile 14. Finished anyway.', tags: ['running'], daysAgo: 3 },
      { caption: 'week 9 of training, legs are gone', tags: ['marathon'], daysAgo: 12 },
    ],
  },
  {
    username: 'sunnyclay',
    display_name: 'Sunny',
    bio: 'Ceramics. Wobbly mugs with a lot of personality.',
    location: 'Portland, OR',
    interests: ['Art', 'Life'],
    category: 'Art',
    joinedDaysAgo: 6,
    pull: 1,
    posts: [
      { caption: 'Day 6 here. 2 followers. This is my first ever mug.', tags: ['ceramics'], daysAgo: 1 },
      { caption: 'it collapsed. posting it anyway.', tags: ['pottery'], daysAgo: 3 },
    ],
  },
  {
    username: 'devontalks',
    display_name: 'Devon',
    bio: 'Explaining money to people my age because nobody explained it to me.',
    location: 'Brooklyn, NY',
    interests: ['Education', 'Business'],
    category: 'Education',
    joinedDaysAgo: 132,
    pull: 8,
    posts: [
      { caption: 'Your first £500 saved is harder than your first £5,000. Here is why.', tags: ['money'], daysAgo: 2 },
      { caption: '60 second story: how I paid off my first card', tags: ['finance'], daysAgo: 10 },
    ],
  },
  {
    username: 'kitpixels',
    display_name: 'Kit',
    bio: 'Pixel art, tiny worlds, one game I will probably never finish.',
    location: 'Kyoto, JP',
    interests: ['Art', 'Gaming'],
    category: 'Technology',
    joinedDaysAgo: 19,
    pull: 3,
    posts: [
      { caption: 'Every tile here was placed by hand. 11,204 of them.', tags: ['pixelart', 'gamedev'], daysAgo: 2 },
      { caption: 'my whole game is one room so far. it is a good room.', tags: ['gamedev'], daysAgo: 6 },
    ],
  },
  {
    username: 'harperhooks',
    display_name: 'Harper',
    bio: 'Songwriter. I only post the choruses.',
    location: 'Nashville, TN',
    interests: ['Music', 'Life'],
    category: 'Music',
    joinedDaysAgo: 105,
    pull: 7,
    posts: [
      { caption: 'Wrote this in a car park waiting for my shift.', tags: ['songwriting'], daysAgo: 1 },
      { caption: 'chorus #91 of the year', tags: ['music'], daysAgo: 11 },
    ],
  },
  {
    username: 'omarcooks',
    display_name: 'Omar',
    bio: 'One pan, one hob, student budget. Recipes under £3.',
    location: 'Cairo, EG',
    interests: ['Food', 'Education'],
    category: 'Food',
    joinedDaysAgo: 11,
    pull: 2,
    posts: [
      { caption: 'Dinner for 90p. It is genuinely good, I promise.', tags: ['cheapeats'], daysAgo: 2 },
      { caption: 'the sauce that saved my entire term', tags: ['food'], daysAgo: 5 },
    ],
  },
  {
    username: 'irisclips',
    display_name: 'Iris',
    bio: 'Editor for other creators. Occasionally post my own stuff.',
    location: 'São Paulo, BR',
    interests: ['Life', 'Photography'],
    category: 'Other',
    joinedDaysAgo: 160,
    pull: 10,
    posts: [
      { caption: 'Same clip, 3 edits. Which one keeps you watching?', tags: ['editing'], daysAgo: 4 },
      { caption: 'free transition pack because someone did that for me once', tags: ['editing'], daysAgo: 16 },
    ],
  },
  {
    username: 'basilgrows',
    display_name: 'Basil',
    bio: 'Balcony garden, 3 square metres, absurd amount of tomatoes.',
    location: 'Naples, IT',
    interests: ['Life', 'Food'],
    category: 'Other',
    joinedDaysAgo: 9,
    pull: 2,
    posts: [
      { caption: 'Week 1 vs week 9. Same balcony.', tags: ['garden'], daysAgo: 2 },
      { caption: 'first tomato. I am emotional about a tomato.', tags: ['growing'], daysAgo: 7 },
    ],
  },
];

/** Captions used for the generated supporting cast, kept per category. */
export const FILLER_CAPTIONS: Record<Category, string[]> = {
  Gaming: [
    'clip of the week, no context',
    'ranked run, day 12',
    'this took 60 attempts',
    'new setup, same bad aim',
  ],
  Music: [
    'unfinished, but I like it',
    'voice memo turned into this',
    '3am loop',
    'cover of my favourite song',
  ],
  Comedy: ['two jokes, one worked', 'the bit', 'my friends found this funny so', 'sketch #7'],
  Fitness: ['week 6 check in', 'small PR, big feeling', 'rest day post', 'form check please'],
  Art: ['sketchbook page', 'work in progress', 'finished this at last', 'first attempt at this style'],
  Business: ['first sale this week', 'stall day', 'packaging test', 'learning as I go'],
  Sports: ['drill I am working on', 'game highlights', 'training day', 'slow progress is progress'],
  Fashion: ['fit of the day', 'thrift find', 'made this jacket', 'colour experiment'],
  Food: ['tried something new', 'cheap and good', 'first time making this', 'family recipe'],
  Technology: ['built this today', 'work in progress build', 'tiny tool I made', 'learning log'],
  Education: ['one thing I learned today', 'quick explainer', 'study setup', 'notes that helped me'],
  Photography: ['golden hour', 'roll #14', 'street, unposed', 'first portrait session'],
  Life: ['a small good thing today', 'weekend, documented', 'this made me laugh', 'view from the walk home'],
  Other: ['showing up today', 'small update', 'trying something', 'day one of something new'],
};

export const FILLER_BIOS = [
  'Here to figure it out in public.',
  'Starting at zero, on purpose.',
  'New here. Be nice.',
  'Making things after work.',
  'Consistency over talent.',
  'Just started. Long way to go.',
];

export const FIRST_NAMES = [
  'ava', 'liam', 'noah', 'mia', 'eli', 'zoe', 'kai', 'nia', 'leo', 'ivy', 'jude', 'remy',
  'sol', 'tess', 'finn', 'wren', 'otis', 'juno', 'cruz', 'lena', 'arlo', 'maya', 'rico',
  'sage', 'nico', 'dara', 'ezra', 'bex', 'joss', 'kira',
];

export const HANDLE_SUFFIXES = [
  'made', 'daily', 'hq', 'studio', 'irl', 'works', 'club', 'tv', 'lab', 'x', 'co', 'now',
];
