// Separate repeatable proving ground. It never participates in campaign rewards.
module.exports = {
  id: 0,
  name: "Полігон підвіски",
  meters: 180,
  length: 180,
  max_ticks: 10800,
  hint: "Рівна ділянка → нерівність 0,2 м → підйом → гребінь → трамплін.",
  bridges: [],
  gears: [],
  fuel: [70, 140],
  terrain: [[-40, 0], [20, 0], [21, .2], [22, 0], [35, 0], [55, 7.28], [70, 9], [85, 7], [95, 4], [106, 4], [114, 7.2], [117, 7.8], [122, 2], [145, 2], [160, 0], [210, 0]],
  surfaces: [{
    from: 155,
    to: 175,
    kind: "ice"
  }]
};
