export function tvmazeSeriesId(showId: number): string {
  return `tvmaze-series-${positiveProviderId(showId, "show")}`;
}

export function tvmazeSeasonId(seasonId: number): string {
  return `tvmaze-season-${positiveProviderId(seasonId, "season")}`;
}

export function tvmazeEpisodeId(episodeId: number): string {
  return `tvmaze-episode-${positiveProviderId(episodeId, "episode")}`;
}

export function tvmazeDerivedSeasonId(showId: number, seasonNumber: number): string {
  return `${tvmazeSeriesId(showId)}-season-${positiveProviderId(seasonNumber, "season number")}`;
}

export function tvmazeSourceId(kind: "show" | "season" | "episode", id: number): string {
  return `${kind}:${positiveProviderId(id, kind)}`;
}

export function tvmazeDerivedSeasonSourceId(showId: number, seasonNumber: number): string {
  return `season-derived:${positiveProviderId(showId, "show")}:${positiveProviderId(seasonNumber, "season number")}`;
}

function positiveProviderId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid TVmaze ${label} ID: ${value}.`);
  }
  return value;
}
