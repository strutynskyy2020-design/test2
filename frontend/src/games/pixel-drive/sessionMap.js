// Game/profile versions describe save compatibility. Generator versions describe
// the immutable map: an older cached browser must not run a newly authored map
// under a newer server session. This check applies only when starting a drive.
function assertSessionMap(session, level, requested) {
  if (session.generatorVersion !== level.generatorVersion || session.seed !== level.seed ||
      session.stageId !== level.stageId || session.mode !== requested.mode ||
      session.world_id !== requested.worldId || session.vehicle_id !== requested.vehicleId) {
    const message='Траса оновилась. Перезавантажте сторінку, щоб почати заїзд.';
    const error=new Error(message);
    error.response={status:409,data:{detail:message}};
    throw error;
  }
}
module.exports={assertSessionMap};
