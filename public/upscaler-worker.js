const VERSION = '1.31.1'
const MODEL_URL = 'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx'
const RUNTIME_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSION}/dist/`
const TILE_SIZE = 128
const OVERLAP = 16
const cancelledJobs = new Set()
let session = null
let modelBytes = null
let runtime = null
let backend = 'wasm'

function send(message, transfer = []) {
  self.postMessage(message, transfer)
}

function cancelled(id) {
  return cancelledJobs.has(id)
}

async function downloadModel(id) {
  send({ type: 'status', id, message: 'Loading the Real-ESRGAN model…' })
  const response = await fetch(MODEL_URL, { cache: 'force-cache', mode: 'cors' })
  if (!response.ok || !response.body) throw new Error('The AI model could not be downloaded. Check your connection and try again.')
  const total = Number(response.headers.get('content-length')) || null
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0
  while (true) {
    if (cancelled(id)) {
      await reader.cancel()
      throw new Error('Processing cancelled.')
    }
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.byteLength
      send({ type: 'model-progress', id, loaded, total })
    }
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function getRuntime(useGpu) {
  const url = `${RUNTIME_BASE}${useGpu ? 'ort.webgpu.min.mjs' : 'ort.min.mjs'}`
  const ort = await import(url)
  ort.env.wasm.wasmPaths = RUNTIME_BASE
  ort.env.wasm.numThreads = 1
  return ort
}

async function initialize(id) {
  if (session) return
  modelBytes ??= await downloadModel(id)
  if (cancelled(id)) throw new Error('Processing cancelled.')
  send({ type: 'status', id, message: 'Starting the local AI engine…' })
  if ('gpu' in self.navigator) {
    try {
      runtime = await getRuntime(true)
      session = await runtime.InferenceSession.create(modelBytes, { executionProviders: ['webgpu'] })
      backend = 'webgpu'
    } catch {
      session = null
      runtime = null
    }
  }
  if (!session) {
    runtime = await getRuntime(false)
    session = await runtime.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] })
    backend = 'wasm'
  }
  send({ type: 'status', id, message: backend === 'webgpu' ? 'AI model ready · WebGPU acceleration' : 'AI model ready · WebAssembly CPU mode' })
}

async function switchToWasm(id) {
  if (backend === 'wasm' || !modelBytes) throw new Error('This device could not run the AI model. Try a supported desktop browser or a smaller image.')
  await session?.release()
  runtime = await getRuntime(false)
  session = await runtime.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] })
  backend = 'wasm'
  send({ type: 'status', id, message: 'WebGPU is unavailable for this model on this device. Continuing with the WebAssembly CPU fallback…' })
}

async function infer(input, width, height, id) {
  if (!session || !runtime) throw new Error('The AI model did not initialize.')
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  if (!inputName || !outputName) throw new Error('The AI model has an unsupported input or output layout.')
  const execute = async () => {
    const tensor = new runtime.Tensor('float32', input, [1, 3, height, width])
    const outputs = await session.run({ [inputName]: tensor }, [outputName])
    const output = outputs[outputName]
    const expectedLength = 3 * height * 4 * width * 4
    if (!output || output.dims.length !== 4 || output.dims[1] !== 3 || output.dims[2] !== height * 4 || output.dims[3] !== width * 4 || output.data?.length !== expectedLength) throw new Error('The loaded model returned an unexpected image size.')
    for (let index = 0; index < output.data.length; index++) {
      if (!Number.isFinite(output.data[index])) throw new Error('The AI model returned invalid pixel data. Try again or use a smaller image.')
    }
    return { data: output.data, width: output.dims[3], height: output.dims[2] }
  }
  try {
    return await execute()
  } catch (error) {
    if (backend !== 'webgpu') throw error
    await switchToWasm(id)
    return execute()
  }
}

async function upscale({ id, image, factor }) {
  let tileCanvas = null
  let outputCanvas = null
  try {
    await initialize(id)
    if (cancelled(id)) throw new Error('Processing cancelled.')
    const outputWidth = image.width * factor
    const outputHeight = image.height * factor
    outputCanvas = new OffscreenCanvas(outputWidth, outputHeight)
    const outputContext = outputCanvas.getContext('2d', { alpha: true })
    if (!outputContext) throw new Error('This browser could not allocate the enhanced image preview.')
    outputContext.imageSmoothingEnabled = true
    outputContext.imageSmoothingQuality = 'high'
    const columns = Math.ceil(image.width / TILE_SIZE)
    const rows = Math.ceil(image.height / TILE_SIZE)
    const total = columns * rows
    const coverageMap = new Uint8Array(total)
    const tileAudit = []
    let completed = 0

    for (let y = 0; y < image.height; y += TILE_SIZE) {
      for (let x = 0; x < image.width; x += TILE_SIZE) {
        if (cancelled(id)) throw new Error('Processing cancelled.')
        const coreWidth = Math.min(TILE_SIZE, image.width - x)
        const coreHeight = Math.min(TILE_SIZE, image.height - y)
        const cropX = Math.max(0, x - OVERLAP)
        const cropY = Math.max(0, y - OVERLAP)
        const cropRight = Math.min(image.width, x + coreWidth + OVERLAP)
        const cropBottom = Math.min(image.height, y + coreHeight + OVERLAP)
        const cropWidth = cropRight - cropX
        const cropHeight = cropBottom - cropY
        tileCanvas ??= new OffscreenCanvas(cropWidth, cropHeight)
        if (tileCanvas.width !== cropWidth || tileCanvas.height !== cropHeight) {
          tileCanvas.width = cropWidth
          tileCanvas.height = cropHeight
        }
        const tileContext = tileCanvas.getContext('2d', { willReadFrequently: true })
        if (!tileContext) throw new Error('The browser could not prepare an image tile for AI processing.')
        tileContext.clearRect(0, 0, cropWidth, cropHeight)
        tileContext.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
        const pixels = tileContext.getImageData(0, 0, cropWidth, cropHeight).data
        const planeSize = cropWidth * cropHeight
        const input = new Float32Array(planeSize * 3)
        for (let pixel = 0; pixel < planeSize; pixel++) {
          const source = pixel * 4
          input[pixel] = pixels[source] / 255
          input[planeSize + pixel] = pixels[source + 1] / 255
          input[planeSize * 2 + pixel] = pixels[source + 2] / 255
        }
        const output = await infer(input, cropWidth, cropHeight, id)
        if (cancelled(id)) throw new Error('Processing cancelled.')
        const modelWidth = cropWidth * 4
        const modelHeight = cropHeight * 4
        const audit = {
          tileId: completed,
          input: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
          expectedModelOutput: { width: modelWidth, height: modelHeight },
          actualModelOutput: { width: output.width, height: output.height },
          destination: { x: x * factor, y: y * factor, width: coreWidth * factor, height: coreHeight * factor },
          status: 'processing',
          covered: false,
        }
        if (output.width !== modelWidth || output.height !== modelHeight) throw new Error(`Tile ${audit.tileId + 1} returned unexpected dimensions.`)
        tileAudit.push(audit)
        const modelCanvas = new OffscreenCanvas(modelWidth, modelHeight)
        const modelContext = modelCanvas.getContext('2d', { alpha: false })
        if (!modelContext) throw new Error('The browser could not assemble the enhanced image tile.')
        const rgba = new Uint8ClampedArray(modelWidth * modelHeight * 4)
        const modelPlaneSize = modelWidth * modelHeight
        for (let pixel = 0; pixel < modelPlaneSize; pixel++) {
          const target = pixel * 4
          rgba[target] = Math.max(0, Math.min(255, Math.round(output.data[pixel] * 255)))
          rgba[target + 1] = Math.max(0, Math.min(255, Math.round(output.data[modelPlaneSize + pixel] * 255)))
          rgba[target + 2] = Math.max(0, Math.min(255, Math.round(output.data[modelPlaneSize * 2 + pixel] * 255)))
          rgba[target + 3] = 255
        }
        modelContext.putImageData(new ImageData(rgba, modelWidth, modelHeight), 0, 0)
        outputContext.drawImage(modelCanvas, (x - cropX) * 4, (y - cropY) * 4, coreWidth * 4, coreHeight * 4, x * factor, y * factor, coreWidth * factor, coreHeight * factor)
        coverageMap[completed] = 1
        tileAudit[completed].status = 'complete'
        tileAudit[completed].covered = true
        completed++
        send({ type: 'progress', id, completed, total })
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    if (cancelled(id)) throw new Error('Processing cancelled.')
    const coveredTiles = coverageMap.reduce((count, covered) => count + covered, 0)
    const auditIsComplete = tileAudit.length === total && tileAudit.every(tile => tile.status === 'complete' && tile.covered && tile.destination.x >= 0 && tile.destination.y >= 0 && tile.destination.x + tile.destination.width <= outputWidth && tile.destination.y + tile.destination.height <= outputHeight)
    if (completed !== total || coveredTiles !== total || !auditIsComplete) throw new Error('The enhanced image is incomplete because one or more tiles did not cover their output region.')
    outputContext.globalCompositeOperation = 'destination-in'
    outputContext.drawImage(image, 0, 0, outputWidth, outputHeight)
    const result = outputCanvas.transferToImageBitmap()
    send({ type: 'result', id, image: result, width: outputWidth, height: outputHeight, backend, integrity: { expectedTiles: total, completedTiles: completed, coveredTiles }, tileAudit }, [result])
  } catch (error) {
    send({ type: 'error', id, message: error instanceof Error ? error.message : 'The AI model could not process this image.', cancelled: cancelled(id) })
  } finally {
    cancelledJobs.delete(id)
    tileCanvas = null
    outputCanvas = null
    image.close()
  }
}

self.onmessage = event => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelledJobs.add(message.id)
    return
  }
  void upscale(message)
}
