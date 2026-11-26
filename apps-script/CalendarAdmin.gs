function mondayOf_(d) {
  var dow = Number(Utilities.formatDate(d, CONFIG.timezone, 'u'));
  return new Date(d.getTime() - (dow - 1) * 86400000);
  }

  function weeklyTrialTally() {
  var groups = ghlGroups_();
  var locs = ['Auburn', 'Concord', 'Marrickville', 'Sydenham', 'Sylvania'];
  Logger.log('WEEK         AUB  CON  MAR  SYD  SYL  TOTAL');
  for (var w = 8; w >= 0; w--) {
  var mon = mondayOf_(new Date(new Date().getTime() - w * 7 * 86400000));
  var start = dateAt_(mon, '00:00');
  var end = endOfDay_(new Date(start.getTime() + 6 * 86400000));
  var cells = [Utilities.formatDate(start, CONFIG.timezone, 'yyyy-MM-dd')];
  var tot = 0;
  locs.forEach(function (l) {
  var n = eventsForLocation_(l, groups, start, end).length;
  cells.push(String(n));
  tot = tot + n;
  });
  cells.push(String(tot));
  Logger.log(cells.join('    '));
  }
}