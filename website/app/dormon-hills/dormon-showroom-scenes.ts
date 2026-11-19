import { blocks, overview } from '@/data/dormon-showroom-scenes.json';

export type Outline = {
  position: readonly number[];
  outline: readonly (readonly number[])[];
};

type SceneImage = {
  file: string;
  width: number;
  height: number;
  source: string;
};

type Scene = SceneImage & Outline & {
  floors: Readonly<Partial<Record<number, Outline>>>;
};

export const dormonShowroomOverview: SceneImage = overview;
export const dormonShowroomScenes: Readonly<Partial<Record<string, Scene>>> = blocks;
