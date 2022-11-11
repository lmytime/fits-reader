import { PrimaryHDU } from "./primary-hdu";

// export * from "./fits-structure";
// export * from "./primary-hdu";

(async () => {
  const hdu = await new PrimaryHDU(
    "jw01328-c1006_t014_miri_f560w_i2d.fits"
  ).load();
  hdu.getLayerStats(0);

  // const images = hdu.getImageStructures();
  // images.forEach((image) => {
  //   const values = image.getDataValuesArray();
  //   console.log(values);
  // });
})();
