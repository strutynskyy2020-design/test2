// Derive achievement badges from live user data (backend has no achievements table).
export const getAchievements = (user) => {
  if (!user) return [];
  return [
    {
      id: "streak_7",
      title: "7 днів поспіль",
      icon: "flame",
      color: "#FF5C00",
      unlocked: user.streak >= 7,
      progress: `${Math.min(user.streak, 7)}/7`,
    },
    {
      id: "streak_30",
      title: "30 днів поспіль",
      icon: "flame",
      color: "#FFB800",
      unlocked: user.streak >= 30,
      progress: `${Math.min(user.streak, 30)}/30`,
    },
    {
      id: "earn_5k",
      title: "5 000 балів",
      icon: "trophy",
      color: "#FFB800",
      unlocked: user.total_earned >= 5000,
    },
    {
      id: "earn_25k",
      title: "25 000 балів",
      icon: "crown",
      color: "#FFB800",
      unlocked: user.total_earned >= 25000,
    },
    {
      id: "lvl_10",
      title: "Рівень 10",
      icon: "sparkles",
      color: "#00F0FF",
      unlocked: (user.level ?? 1) >= 10,
    },
    {
      id: "mentor",
      title: "Наставник",
      icon: "graduation-cap",
      color: "#39FF14",
      unlocked: (user.level ?? 1) >= 5,
    },
  ];
};
