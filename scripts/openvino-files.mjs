// Partes do OpenVINO que o KOMA usa: detector de letras na CPU, lido de um modelo ONNX.
// Placa de vídeo, NPU, outros formatos de modelo e versões de depuração ficam fora do
// pacote (o OpenVINO completo tem 167 MB no Linux; isto dá cerca de 100 MB).
const KEEP =
  /^(dist\/|package\.json$|LICENSE|bin\/(ov_node_addon\.node$|(lib)?openvino(_intel_cpu_plugin|_onnx_frontend|_ir_frontend)?(\.so[.\d]*|\.dll)$|(lib)?tbb(12|malloc|bind_2_5)?(\.so[.\d]*|\.dll)$|libhwloc\.so[.\d]*$|TBB-LICENSE$|licenses(\/|$)))/

/** Caminho relativo à pasta do pacote (com /): fica no pacote do KOMA? */
export function openvinoFile(relative) {
  return relative === '' || relative === 'bin' || relative === 'dist' || KEEP.test(relative)
}
