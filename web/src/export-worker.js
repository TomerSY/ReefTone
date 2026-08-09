import {processImageData} from "./color-math.js";

self.addEventListener("message", async event => {
  const {buffer, type, settings, outputType, quality} = event.data;
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], {type}));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", {willReadFrequently: true});
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    processImageData(imageData, settings, progress => {
      self.postMessage({kind: "progress", progress});
    });
    context.putImageData(imageData, 0, 0);
    const exportOptions = {type: outputType};
    if (typeof quality === "number") exportOptions.quality = quality;
    const blob = await canvas.convertToBlob(exportOptions);
    self.postMessage({kind: "complete", blob});
  } catch (error) {
    self.postMessage({kind: "error", message: error.message || "Export failed"});
  }
});
