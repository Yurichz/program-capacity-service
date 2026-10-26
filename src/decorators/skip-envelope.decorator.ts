import { SetMetadata } from '@nestjs/common';
export const SKIP_ENVELOPE = 'app:skip-envelope';
/** For a deliberately raw JSON response. Streams/files are detected separately. */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);
