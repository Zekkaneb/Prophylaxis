import { AVATAR_MAX_LENGTH } from './playerProfile.ts';

/**
 * Turns a picked file into the profile's picture: a centred square crop,
 * scaled to 256px and encoded as JPEG. Doing the resize here — not in the
 * browser's upload path — keeps the stored profile a few kilobytes instead of
 * several megabytes, and squares off portrait phone photos so the circle stays
 * a face.
 */

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.86;

export class AvatarError extends Error {}

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarError('That file is not an image.');
  }

  const image = await loadImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;

    const context = canvas.getContext('2d');
    if (!context) throw new AvatarError('This browser could not prepare the picture.');

    const scale = Math.max(AVATAR_SIZE / image.naturalWidth, AVATAR_SIZE / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
    if (dataUrl.length > AVATAR_MAX_LENGTH) {
      throw new AvatarError('That picture is too detailed — try a smaller one.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(image.src);
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarError('That picture could not be read.'));
    };
    image.src = url;
  });
}
