export async function prepareAvatar(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > 12_000_000) throw new Error("图片超过 12 MB，请选择较小的图片");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("无法读取这张图片，请换一张");
  });
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("图片尺寸过大，请先缩小后再上传");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (data.length <= 16000) return data;
    }
    throw new Error("图片细节过多，请选择更简单的头像");
  } finally {
    bitmap.close();
  }
}
