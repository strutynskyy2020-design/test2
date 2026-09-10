// Separate repeatable proving ground. It never participates in campaign rewards.
module.exports = {
  id: 0,
  name: "Контрольний полігон",
  meters: 420,
  length: 420,
  max_ticks: 10800,
  hint: "Рівна дорога, підйоми з місця й розгону, нерівності, стрибок, лід і низька стеля.",
  bridges: [],
  gears: [],
  fuel: [70, 140, 230, 340],
  terrain: [[-120, 0], [20, 0], [21, .2], [22, 0], [35, 0], [55, 7.28], [70, 9], [85, 7], [95, 4], [106, 4], [114, 7.2], [117, 7.8], [122, 2], [145, 2], [160, 0], [210, 0], [235, 9.1], [246, 9.1], [265, 0], [277,.3],[282,0],[287,.45],[292,0],[297,.6],[304,0],[312,1.2],[318,0],[340,0],[360,0],[370,0],[430,0],[550,0]],
  ceilings: [{from: 340, to: 370, height: 3.4}],
  modules: [{id:'flat',type:'flat',from:-30,to:20},{id:'bump',type:'bump',from:20,to:25},{id:'climb',type:'climb',from:35,to:70},{id:'jump',type:'jump',from:106,to:145},{id:'ice',type:'ice',from:155,to:175},{id:'running-climb',type:'climb',from:210,to:246},{id:'bumps',type:'bumps',from:270,to:320},{id:'ceiling',type:'ceiling',from:340,to:370}],
  surfaces: [{
    from: 155,
    to: 175,
    kind: "ice"
  }]
};
