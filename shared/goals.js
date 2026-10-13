// Daily and weekly goals: three small things to do each day and one bigger one each
// week, picked for everyone from the day number. Progress is measured from the
// counters in profile.stats (what you've done since the goal was set).
export const DAILY = [
  { id: 'harvest', stat: 'harvest', n: 15, text: 'Harvest 15 crops', reward: 60 },
  { id: 'sell', stat: 'sold', n: 10, text: 'Sell 10 things to Rosa', reward: 60 },
  { id: 'cook', stat: 'cook', n: 1, text: 'Cook a meal', reward: 40 },
  { id: 'fish', stat: 'fish', n: 3, text: 'Catch 3 fish', reward: 80 },
  { id: 'water', stat: 'water', n: 10, text: 'Water 10 crops', reward: 50 },
  { id: 'talk', stat: 'talk', n: 2, text: 'Chat with 2 villagers', reward: 40 },
  { id: 'pet', stat: 'pet', n: 1, text: 'Pet your animals (or your pet)', reward: 40 },
  { id: 'craft', stat: 'craft', n: 1, text: 'Make something in a machine', reward: 70 },
  { id: 'plant', stat: 'plant', n: 10, text: 'Plant 10 seeds', reward: 50 },
  { id: 'gift', stat: 'gift', n: 1, text: 'Give someone a gift', reward: 50 },
];
export const WEEKLY = [
  { id: 'earn', stat: 'earned', n: 3000, text: 'Earn 🪙3,000', reward: 500 },
  { id: 'ship', stat: 'sold', n: 80, text: 'Sell 80 things to Rosa', reward: 450 },
  { id: 'angler', stat: 'fish', n: 25, text: 'Catch 25 fish', reward: 500 },
  { id: 'farmer', stat: 'harvest', n: 120, text: 'Harvest 120 crops', reward: 500 },
  { id: 'maker', stat: 'craft', n: 10, text: 'Make 10 things in machines', reward: 550 },
];
export const weekOf = (day) => Math.floor((day - 1) / 7);

// The day's goals (3) and the week's (1), the same for everyone.
export function goalsFor(day) {
  const h = (n) => ((n * 2654435761) >>> 0) % 997;
  const pool = [...DAILY];
  const daily = [];
  for (let i = 0; i < 3; i++) daily.push(pool.splice(h(day * 7 + i) % pool.length, 1)[0]);
  return { daily, weekly: WEEKLY[h(weekOf(day) + 3) % WEEKLY.length] };
}
