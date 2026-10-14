// The village economy: where money starts, who pays whom, and what City Hall takes in
// and pays out. Money moves in a loop: players and villagers earn from jobs and sales,
// spend in each other's shops and stalls, and pay taxes and fees to City Hall, which
// pays the public servants, the city jobs, projects, prizes and interest.

export const TREASURY_START = 50_000;
export const PLAYER_START = 1000;
export const NPC_BASE = 1000;

// What each villager does for a living. `city`: paid by the treasury; `for`: paid by
// another villager (their employer); `self`: lives on what they sell; `kid`: pocket
// money from odd jobs (city shifts). `pay` is coins a day; `savings` on top of the base.
export const LIVELIHOODS = {
  mabel:    { kind: 'city', job: 'City Clerk', pay: 140, savings: 1500 },
  ellis:    { kind: 'city', job: 'Village Doctor', pay: 160, savings: 2500 },
  sam:      { kind: 'city', job: 'Postie', pay: 100, savings: 600 },
  juniper:  { kind: 'city', job: 'Park Gardener', pay: 90, savings: 500 },
  willa:    { kind: 'city', job: 'Librarian', pay: 90, savings: 700 },
  felix:    { kind: 'city', job: 'Observatory Keeper', pay: 80, savings: 900 },
  lila:     { kind: 'for', boss: 'rosa', job: 'Baker at Rosa’s Market', pay: 90, savings: 400 },
  theo:     { kind: 'for', boss: 'gus', job: 'Musician at the saloon', pay: 60, savings: 150 },
  rosa:     { kind: 'self', job: 'Runs Rosa’s Market', savings: 4000 },
  otto:     { kind: 'self', job: 'Runs Otto’s Furniture', savings: 3500 },
  gus:      { kind: 'self', job: 'Runs the saloon', savings: 3000 },
  hazel:    { kind: 'self', job: 'Fisher', savings: 800 },
  bram:     { kind: 'self', job: 'Blacksmith', savings: 1500 },
  marigold: { kind: 'self', job: 'Florist', savings: 700 },
  nell:     { kind: 'self', job: 'Knitter', savings: 1200 },
  fern:     { kind: 'self', job: 'Beekeeper', savings: 900 },
  rowan:    { kind: 'self', job: 'Farmer', savings: 1100 },
  ivy:      { kind: 'self', job: 'Painter', savings: 300 },
  pip:      { kind: 'kid', job: 'Odd jobs', savings: -800 },
  bea:      { kind: 'kid', job: 'Odd jobs', savings: -700 },
};
export const startWallet = (id) => Math.max(100, NPC_BASE + (LIVELIHOODS[id]?.savings || 0));
// Self-employed villagers sell to visitors and wholesalers on days they have no stall:
// roughly this much a day (outside money coming in, taxed like any sale).
export const TRADE_INCOME = { rosa: 260, otto: 200, gus: 220, hazel: 90, bram: 110, marigold: 80, nell: 80, fern: 90, rowan: 120, ivy: 50 };
// Living costs: what each villager spends a day on food and drink in the village (it goes
// to Rosa's Market and the saloon, as real sales).
export const LIVING = 35;

// Default rates (the council can change them).
export const SALES_TAX = 0.05;
export const PROPERTY_TAX = 1; // coins per 10 tiles a month
export const BUILD_PERMIT = 75; // the first time a plot gets a roof
export const WELCOME_GRANT = 0; // (the richer start gives new players their coins directly)
export const SAVINGS_RATE = 0.01; // a week
export const SAVINGS_CAP = 300; // most interest anyone earns in a week
export const FESTIVAL_FEE = 25;
export const FESTIVAL_SPONSOR = 400; // City Hall's share of the prize pool
export const PRIZE_SPLIT = [0.5, 0.3, 0.2];

// Ledger categories (City Hall's books).
export const INCOME = {
  land: 'Land sales', licence: 'Business licences', rent: 'Stall rent', salesTax: 'Sales tax', propertyTax: 'Property tax',
  permit: 'Building permits', utilities: 'Utilities', postage: 'Postage', loans: 'Loan repayments', fees: 'Festival fees', deposits: 'Savings deposits',
};
export const SPENDING = {
  payroll: 'Public servants', jobs: 'City jobs', projects: 'Public projects', roads: 'Roads', loans: 'Loans',
  prizes: 'Festival prizes', interest: 'Savings interest', withdrawals: 'Savings withdrawals', grants: 'Grants',
};

// City jobs: shifts anyone (players and villagers) can take at City Hall, paid from the
// treasury. Each sends you to a handful of spots to do a little task.
export const CITY_JOBS = {
  gardener: { name: 'Park Gardener', icon: '🌷', verb: 'Tend the flower bed', where: 'Willow Park', area: 'Willow Park', spots: 5, pay: 60, hours: [7, 18], shifts: 3 },
  sweeper:  { name: 'Street Sweeper', icon: '🧹', verb: 'Sweep up here', where: 'the town square', area: 'Town Square', spots: 6, pay: 50, hours: [6, 20], shifts: 4 },
  beach:    { name: 'Beach Cleaner', icon: '🐚', verb: 'Pick up the litter', where: 'Seashell Beach', area: 'Seashell Beach', spots: 5, pay: 65, hours: [7, 19], shifts: 2 },
  mail:     { name: 'Mail Carrier', icon: '✉️', verb: 'Deliver the letter', where: 'houses around the village', spots: 4, pay: 75, hours: [8, 17], shifts: 3 },
  lamps:    { name: 'Lamplighter', icon: '🏮', verb: 'Light the lamp', where: 'the square and the park', spots: 6, pay: 55, hours: [17, 22], shifts: 2 },
  warden:   { name: 'Market Warden', icon: '📋', verb: 'Check the stall', where: 'this week’s market stalls', spots: 4, pay: 65, hours: [8, 18], shifts: 2 },
};
export const HELPER_PAY = 45; // villager shops pay helpers out of their own pocket
export const JOB_HOURS = 2; // in-game hours to finish a shift
export const fmtHour = (h) => `${((Math.floor(h) + 11) % 12) + 1} ${h % 24 < 12 ? 'AM' : 'PM'}`;
