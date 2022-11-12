import { readFile } from "fs";
import { FitsStructure } from "./fits-structure";

abstract class Filter {
  static basicFilter(structure: FitsStructure): Filter {
    const stats = structure.getDataStats();
    const max = stats.median + stats.stdDev;
    const min = stats.median - stats.stdDev;
    return {
      filter: (value: number) => {
        return Math.min(Math.max(value, min), max);
      },
    };
  }

  filter(value: number): number {
    throw new Error("Not implemented");
  }
}

export class PrimaryHDU {
  private static async getFileBuffer(fileName: string) {
    const buffer = await new Promise<Buffer>((resolve, reject) =>
      readFile(fileName, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      })
    );

    if (!buffer) {
      throw new Error(`Unable to load ${fileName}`);
    }

    return buffer;
  }

  static async fromFile(fileName: string) {
    return await new PrimaryHDU(fileName).load();
  }

  private readonly fileName: string;

  private primaryHDU: FitsStructure | undefined;

  // All structures
  private structures: Array<FitsStructure> | undefined;

  // All image structures (TODO reduce duplication)
  private images: Array<FitsStructure> | undefined;

  private stats: Array<{
    min: number;
    max: number;
    median: number;
    mean: number;
    stdDev: number;
  }> = [];

  constructor(fileName: string) {
    this.fileName = fileName;
  }

  async load() {
    if (!this.primaryHDU) {
      this.primaryHDU = new FitsStructure(
        await PrimaryHDU.getFileBuffer(this.fileName)
      );

      this.structures = [];
      let next = this.primaryHDU.getNextStructure();
      while (next) {
        this.structures.push(next);
        next = next.getNextStructure();
      }
    }

    return this;
  }

  getHdu() {
    if (!this.primaryHDU) {
      throw new Error("Must await `load` first");
    }

    return this.primaryHDU;
  }

  getStructure(layerNum: number) {
    return this.getStructures()[layerNum];
  }

  getStructures() {
    if (!this.structures) {
      throw new Error("Must await `load` first");
    }

    return this.structures;
  }

  getImageStructures() {
    if (this.images) {
      return this.images;
    }

    this.images = this.getStructures().filter((structure) =>
      structure.isImage()
    );

    return this.images;
  }

  getLayerStats(layerNum: number): {
    min: number;
    max: number;
    median: number;
    mean: number;
    stdDev: number;
  } {
    if (this.stats[layerNum]) {
      return this.stats[layerNum];
    }

    this.stats[layerNum] = this.getStructure(layerNum).getDataStats();
    return this.stats[layerNum];
  }

  filterLayer(layerNum: number, filter?: Filter) {
    filter = filter || Filter.basicFilter(this.getStructure(layerNum));

    const filtered: Array<number> = [];
    const data = this.getStructure(layerNum).getDataValues();
    data.forEach((value) => {
      if (!filter) {
        throw new Error("No filter");
      }

      filtered.push(filter.filter(value));
    });

    return filtered;
  }
}
