/** Older TV engines return void from play(); modern browsers return a Promise. */
export function playMedia(media: { play(): Promise<void> | void }): Promise<void> {
  try { return Promise.resolve(media.play()) }
  catch (error) { return Promise.reject(error) }
}
