import { readFile } from "fs";
import { FitsStructure } from "./fits-structure";

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
    return new FitsStructure(await PrimaryHDU.getFileBuffer(fileName));
  }

  private readonly fileName: string;

  private hdu: FitsStructure | undefined;

  // All structures
  private structures: Array<FitsStructure> | undefined;

  // All image structures (TODO reduce duplication)
  private images: Array<FitsStructure> | undefined;

  private stats: Array<{}> = [];

  constructor(fileName: string) {
    this.fileName = fileName;
  }

  async load() {
    if (!this.hdu) {
      this.hdu = await PrimaryHDU.fromFile(this.fileName);
      this.structures = [];
      let next = this.hdu.getNextStructure();
      while (next) {
        this.structures.push(next);
        next = next.getNextStructure();
      }
    }

    return this;
  }

  getHdu() {
    if (!this.hdu) {
      throw new Error("Must await `load` first");
    }

    return this.hdu;
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

  getLayerStats(layerNum: number) {
    if (this.stats[layerNum]) {
      return this.stats[layerNum];
    }

    const data = this.getStructure(layerNum).getDataValuesArray();
    const median = data.sort()[data.length / 2];
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    let sum = 0;
    data.forEach((row) =>
      row.forEach((value) => {
        if (value < min) {
          min = value;
        }

        if (value > max) {
          max = value;
        }

        sum += value;
      })
    );

    const mean = sum / (data.length * data[0].length);
    const foo = data.reduce((rowSum, row) => {
      return (
        rowSum +
        row.reduce((sum, value) => {
          return sum + Math.pow(value - mean, 2);
        }, 0)
      );
    }, 0);
    return { min, max, median, mean, foo };
  }
}
