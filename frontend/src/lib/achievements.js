// Built-in achievements are derived from live profile data. Administrator-issued
// achievements are merged with these definitions by the profile page.
export const getAchievements = (user) => {
  if (!user) return [];
  const streak = Math.max(0, Number(user.streak || 0));
  const totalEarned = Math.max(0, Number(user.total_earned || 0));
  const level = Math.max(1, Number(user.level || 1));

  return [
    {
      id: "streak_7",
      title: "7 днів поспіль",
      description: "Заходь і залишайся активним сім днів без перерви.",
      category: "Активність",
      icon: "flame",
      color: "#FF5C00",
      unlocked: streak >= 7,
      progress: `${Math.min(streak, 7)} / 7 днів`,
      progress_value: Math.min(streak, 7),
      progress_target: 7,
    },
    {
      id: "streak_30",
      title: "30 днів поспіль",
      description: "Підтримуй активну серію протягом цілого місяця.",
      category: "Активність",
      icon: "flame",
      color: "#FFB800",
      unlocked: streak >= 30,
      progress: `${Math.min(streak, 30)} / 30 днів`,
      progress_value: Math.min(streak, 30),
      progress_target: 30,
    },
    {
      id: "earn_5k",
      title: "5 000 балів",
      description: "Зароби сумарно 5 000 Point за квести, ігри та результати.",
      category: "Point",
      icon: "trophy",
      color: "#FFB800",
      unlocked: totalEarned >= 5000,
      progress: `${Math.min(totalEarned, 5000).toLocaleString("uk-UA")} / 5 000 Point`,
      progress_value: Math.min(totalEarned, 5000),
      progress_target: 5000,
    },
    {
      id: "earn_25k",
      title: "25 000 балів",
      description: "Досягни позначки 25 000 зароблених Point.",
      category: "Point",
      icon: "crown",
      color: "#FFB800",
      unlocked: totalEarned >= 25000,
      progress: `${Math.min(totalEarned, 25000).toLocaleString("uk-UA")} / 25 000 Point`,
      progress_value: Math.min(totalEarned, 25000),
      progress_target: 25000,
    },
    {
      id: "lvl_10",
      title: "Рівень 10",
      description: "Прокачай особистий профіль до десятого рівня.",
      category: "Рівні",
      icon: "sparkles",
      color: "#00F0FF",
      unlocked: level >= 10,
      progress: `${Math.min(level, 10)} / 10 рівнів`,
      progress_value: Math.min(level, 10),
      progress_target: 10,
    },
    {
      id: "mentor",
      title: "Наставник",
      description: "Досягни п’ятого рівня та відкрий статус наставника.",
      category: "Рівні",
      icon: "graduation-cap",
      color: "#39FF14",
      unlocked: level >= 5,
      progress: `${Math.min(level, 5)} / 5 рівнів`,
      progress_value: Math.min(level, 5),
      progress_target: 5,
    },
  ];
};
