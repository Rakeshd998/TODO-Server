import mongoose, { Document, Schema } from 'mongoose';

export interface IClip {
  heading: string;
  textToCopy: string[];
  userId: mongoose.Types.ObjectId;
}

export interface IClipDocument extends IClip, Document {}

const clipSchema = new Schema<IClipDocument>(
  {
    heading:    { type: String, required: true, trim: true, maxlength: 100 },
    textToCopy: [{ type: String, maxlength: 2000 }],
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

export const Clip = mongoose.model<IClipDocument>('Clip', clipSchema);
