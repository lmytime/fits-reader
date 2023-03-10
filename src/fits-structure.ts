import { readFile } from "fs";

/**
 * Table 8: Interpretation of valid BITPIX value.
 * Value Data represented
 * 8 Character or unsigned binary integer
 * 16 16-bit two’s complement binary integer
 * 32 32-bit two’s complement binary integer
 * 64 64-bit two’s complement binary integer
 * −32 IEEE single-precision floating point
 * −64 IEEE double-precision floating point
 */
enum PixelDataType {
  UnsignedBinary = "8",
  Signed16 = "16",
  Signed32 = "32",
  Signed64 = "64",
  SingleFloat = "-32",
  DoubleFloat = "-64",
}

class MetaDataParser {
  static checkEntry(entry: string) {
    if (entry.length !== 80) {
      throw new Error(
        `Metadata data entry: ${entry} is ${entry.length} characters. (Max 80)`
      );
    }
  }

  static isValidKeyword(key: string) {
    return key.charAt(0) !== " " && key.length === 8; // TODO other checks
  }

  /**
   * If the two ASCII characters '= ' (decimal 61 followed
   * by decimal 32) are present in Bytes 9 and 10 of the keyword
   * record, this indicates that the keyword has a value field associated with it, unless it is one of the commentary keywords
   * defined in Sect. 4.4.2 (i.e., a HISTORY, COMMENT, or completely
   * blank keyword name), which, by definition, have no value.
   *
   * @param entry
   * @returns A trimmed keyword
   */
  static hasValue(entry: string) {
    return entry.substring(8, 10) === "= ";
  }

  /**
   * Keyword name The first eight bytes of a keyword record, which
   * contain the ASCII name of a metadata quantity (unless it is blank).
   *
   * @param entry
   * @returns The trimmed keyword
   */
  static getKey(entry: string) {
    MetaDataParser.checkEntry(entry);
    const key = entry.substring(0, 8);
    if (MetaDataParser.isValidKeyword(key)) {
      return key.trim();
    }
  }

  static getValue(entry: string) {
    MetaDataParser.checkEntry(entry);
    return entry.substring(9).split("/")[0].trim();
  }

  /**
   * These keywords provide commentary information about the
   * contents or history of the FITS file and may occur any number of
   * times in a header. These keywords shall have no associated value
   * even if the value indicator characters `= ' appear in Bytes 9 and
   * 10 (hence it is recommended that these keywords not contain the
   * value indicator). Bytes 9 through 80 may contain any of the restricted set of ASCII-text characters, decimal 32 through 126
   * (hexadecimal 20 through 7E).
   * In earlier versions of this Standard continued string keywords (see Sect. 4.2.1.2) could be handled as commentary keywords if the relevant convention was not supported.
   * Now CONTINUE keywords shall be honoured as specified in
   * Sect. 4.2.1.2.
   *
   * @param key
   */
  static isCommentaryKeyword(key: string) {
    return ["COMMENT", "HISTORY", "CONTINUE"].includes(key);
  }
}

/**
 * 3.2. Individual FITS Structures
 * The primary HDU and every extension HDU shall consist of
 * one or more 2880-byte header blocks immediately followed by
 * an optional sequence of associated 2880-byte data blocks. The
 * header blocks shall contain only the restricted set of ASCII-text
 * characters, decimal 32 through 126 (hexadecimal 20 through
 * 7E). The ASCII control characters with decimal values less than
 * 32 (including the null, tab, carriage return, and line-feed characters), and the delete character (decimal 127 or hexadecimal 7F)
 * must not appear anywhere within a header block.
 */
export class FitsStructure {
  static readonly BLOCK_SIZE = 2880;

  static readonly RECORD_SIZE = 80;

  static numBlocks(numBytes: number) {
    return Math.ceil(numBytes / FitsStructure.BLOCK_SIZE);
  }

  static getDataValue(dataType: PixelDataType, buff: Buffer, offset: number) {
    switch (dataType) {
      case PixelDataType.UnsignedBinary:
        return buff.readUInt8(offset);
      case PixelDataType.SingleFloat:
        return buff.readFloatBE();
      default:
        throw new Error("DAFS");
    }
  }

  /**
   * A mapping of keyword names mapped to their values.
   */
  private readonly headers = new Map<string, string>();

  /**
   * Raw values of the primary header.
   */
  private rawHeaders: Array<string> | undefined;

  // TODO need to be chronological
  private readonly commentaryHeaders = new Map<string, Array<string>>();

  private readonly rawData: Buffer;

  constructor(data: Buffer) {
    this.rawData = data;
  }

  getNextStructure(): FitsStructure | undefined {
    const nextStart = this.getNumStructureBytes();
    if (this.rawData.length > nextStart) {
      return new FitsStructure(this.rawData.subarray(nextStart));
    }
  }

  getDataBlock(blockNum: number) {
    return this.rawData.subarray(
      (blockNum - 1) * FitsStructure.BLOCK_SIZE,
      blockNum * FitsStructure.BLOCK_SIZE
    );
  }

  /**
   * @returns An array of entries in the primary header as they appear in the file.
   */
  getRawHeaders() {
    // TODO validate headers (sec 4.4.1)
    if (!this.rawHeaders) {
      const metadata: Array<string> = [];
      let found = false;
      let blockNum = 1;
      while (!found) {
        const block = this.getMetadataBlock(blockNum);
        block.forEach((entry) => {
          if (!found) {
            found = entry.startsWith("END");
          }

          metadata.push(entry);
          const key = MetaDataParser.getKey(entry);
          if (key) {
            if (MetaDataParser.isCommentaryKeyword(key)) {
              if (key === "CONTINUE") {
                console.warn("Continue keyword not yet supported.");
              }

              if (!this.commentaryHeaders.get(key)) {
                this.commentaryHeaders.set(key, []);
              }

              const commentary = this.commentaryHeaders.get(key);
              if (!commentary) {
                throw new Error("This really shouldn't happen");
              }

              commentary.push(entry.substring(8));
            } else {
              const value = MetaDataParser.getValue(entry);
              this.headers.set(key, value);
            }
          }
        });

        blockNum++;
      }

      this.rawHeaders = metadata;
    }

    return this.rawHeaders;
  }

  getHeaderMap() {
    if (this.headers.size === 0) {
      this.getRawHeaders();
    }

    return this.headers;
  }

  getNumHeaderBlocks() {
    return FitsStructure.numBlocks(
      this.getRawHeaders().length * FitsStructure.RECORD_SIZE
    );
  }

  getNumDataBlocks() {
    return FitsStructure.numBlocks(this.getDataSize());
  }

  getMetadataValue(key: string) {
    const value = this.getHeaderMap().get(key);
    if (!value) {
      throw new Error(`Unable to find '${key} key in metadata`);
    }

    return value;
  }

  getMetadataBlock(blockNum: number) {
    const metadata: Array<string> = [];
    const buffer = this.getDataBlock(blockNum);
    for (
      let i = 0;
      i < FitsStructure.BLOCK_SIZE;
      i = i + FitsStructure.RECORD_SIZE
    ) {
      metadata.push(
        buffer.subarray(i, i + FitsStructure.RECORD_SIZE).toString()
      );
    }

    return metadata;
  }

  numAxis() {
    try {
      const naxis = this.getMetadataValue("NAXIS");
      const num = parseInt(naxis);
      if (isNaN(num) || num < 0 || num > 999) {
        throw new Error(`Invalid number of axes: ${num}`);
      }

      return num;
    } catch (error) {
      console.error(error);
      throw new Error(`NAXIS keyword missing from metadata`);
    }
  }

  sizeAxis(index: number) {
    const numAxis = this.numAxis();
    if (isNaN(numAxis) || numAxis <= 0) {
      throw new Error(
        `Cannot get index ${index} from data with ${numAxis} axis`
      );
    }

    const length = parseInt(this.getMetadataValue(`NAXIS${index}`));

    // TODO validate
    return length;
  }

  // Support n axis
  centerPixel(): { x: number; y: number } | undefined {
    // TODO validate proper metadata keys
    const x = parseInt(this.getMetadataValue("CRPIX1"));
    const y = parseInt(this.getMetadataValue("CRPIX1"));
    return { x, y };
  }

  getDataUnit(): Buffer {
    const numAxis = this.numAxis();
    if (numAxis === 0) {
      return Buffer.from("");
    } else {
      const startBlock = this.getNumHeaderBlocks(); // + 1;
      const endBlock = startBlock + this.getNumDataBlocks();
      return this.rawData.subarray(
        startBlock * FitsStructure.BLOCK_SIZE,
        endBlock * FitsStructure.BLOCK_SIZE
      );
    }
  }

  /**
   * @returns 1D array of all data values
   */
  getDataValues(): Array<number> {
    const values: Array<number> = [];
    const data = this.getDataUnit();
    const dataType = this.pixelDataType();
    const bytesPerPixel = this.bitsPerPixel() / 8;
    let offset = 0;
    while (offset < data.length) {
      switch (dataType) {
        case PixelDataType.SingleFloat:
          const value = data.readFloatBE(offset);
          values.push(value);
          offset = offset + bytesPerPixel;
          break;
        case PixelDataType.Signed32:
          values.push(data.readInt32BE(offset));
          offset = offset + bytesPerPixel;
          break;
        case PixelDataType.UnsignedBinary:
          values.push(data.readUInt8(offset));
          offset = offset + bytesPerPixel;
          break;
        default:
          throw new Error(dataType);
      }
    }

    return values;
  }

  /**
   * TODO handle n axis.
   * @returns 2D array of all data values.
   */
  getDataValuesArray(): Array<Array<number>> {
    const values: Array<Array<number>> = [];
    const width = this.sizeAxis(1);
    const height = this.sizeAxis(2);
    const data = this.getDataValues();
    let i = 0;
    for (let row = 0; row < height; row++) {
      values[row] = [];
      for (let col = 0; col < width; col++) {
        values[row].push(data[i]);
        i = i + 1;
      }
    }

    return values;
  }

  getDataSize() {
    // TODO returned size is in bits not bytes
    const numAxis = this.numAxis();
    if (numAxis === 0) {
      return numAxis;
    } else {
      let prod = this.bitsPerPixel() / 8;
      for (let i = 1; i <= numAxis; i++) {
        const length = this.sizeAxis(i);
        // TODO check validity
        prod = prod * length;
      }

      return prod;
    }
  }

  getNumStructureBlocks() {
    return this.getNumHeaderBlocks() + this.getNumDataBlocks();
  }

  getNumStructureBytes() {
    return this.getNumStructureBlocks() * FitsStructure.BLOCK_SIZE;
  }

  pixelDataType() {
    return this.getMetadataValue("BITPIX") as PixelDataType;
  }

  isImage() {
    const xtension = this.getMetadataValue("XTENSION");
    return xtension && xtension.toLowerCase().includes("image");
  }

  /**
   * BITPIX keyword. The value field shall contain an integer. The
   * absolute value is used in computing the sizes of data structures.
   * It shall specify the number of bits that represent a data value in
   * the associated data array. The only valid values of BITPIX are
   * given in Table 8. Writers of FITS arrays should select a BITPIX
   * data type appropriate to the form, range of values, and accuracy
   * of the data in the array
   *
   * Table 8: Interpretation of valid BITPIX value.
   * Value Data represented
   * 8 Character or unsigned binary integer
   * 16 16-bit two’s complement binary integer
   * 32 32-bit two’s complement binary integer
   * 64 64-bit two’s complement binary integer
   * −32 IEEE single-precision floating point
   * −64 IEEE double-precision floating point
   */
  bitsPerPixel() {
    const dataType = this.pixelDataType();
    if (Object.values(PixelDataType).includes(dataType)) {
      return Math.abs(parseInt(dataType));
    } else {
      throw new Error(`Invalid pixel data type ${dataType}`);
    }
  }

  getDataStats(): {
    min: number;
    max: number;
    median: number;
    mean: number;
    stdDev: number;
  } {
    const data = this.getDataValues();
    const median = data.sort()[data.length / 2];
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    let sum = 0;
    data.forEach((value) => {
      if (value < min) {
        min = value;
      }

      if (value > max) {
        max = value;
      }

      sum += value;
    });

    const mean = sum / data.length;
    const stdDev = Math.sqrt(
      data.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
        data.length
    );

    return { min, max, median, mean, stdDev };
  }
}
