/** TVmaze wire contracts stay local to catalog tooling. */
export interface TvMazeImage { medium: string | null; original: string | null }
export interface TvMazeRating { average: number | null }
export interface TvMazeCountry { code: string | null }
export interface TvMazeNetwork { name: string; country: TvMazeCountry | null }

export interface TvMazeShow {
  id: number;
  name: string;
  url: string | null;
  language: string | null;
  status: string | null;
  runtime: number | null;
  premiered: string | null;
  ended: string | null;
  officialSite: string | null;
  genres: string[];
  rating: TvMazeRating;
  network: TvMazeNetwork | null;
  webChannel: TvMazeNetwork | null;
  image: TvMazeImage | null;
  summary: string | null;
}

export interface TvMazeSeason {
  id: number;
  number: number;
  url: string | null;
  name: string | null;
  premiereDate: string | null;
  endDate: string | null;
  network: TvMazeNetwork | null;
  webChannel: TvMazeNetwork | null;
  image: TvMazeImage | null;
  summary: string | null;
}

export interface TvMazeEpisode {
  id: number;
  name: string;
  url: string | null;
  season: number;
  number: number | null;
  airdate: string | null;
  runtime: number | null;
  rating: TvMazeRating;
  image: TvMazeImage | null;
  summary: string | null;
}
