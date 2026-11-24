import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('مفتاح Gemini API غير مضبوط على الخادم (GEMINI_API_KEY).');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface SearchSource {
  title: string;
  uri: string;
}

export async function searchEducationalGuidance(query: string): Promise<{
  answer: string;
  sources: SearchSource[];
}> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `أجب باللغة العربية الفصحى وبشكل منظم ودقيق لإدارة مدرسة ثانوية عراقية (إعدادية المنتظر للبنين) حول الاستفسار التالي مع الالتزام بالضوابط التربوية الحديثة:\n\n${query}`,
    config: {
      systemInstruction:
        'أنت مستشار تربوي وإداري متخصص في أنظمة التعليم والامتحانات في وزارة التربية العراقية. قدم إجابات دقيقة ومختصرة وواضحة بالعربية الفصحى.',
      tools: [{ googleSearch: {} }],
    },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks as Array<{ web?: { uri?: string; title?: string } }>) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (uri && title && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }

  return {
    answer: response.text ?? 'تعذر استخراج نص الإجابة من النموذج.',
    sources,
  };
}

export async function generateOrEditSchoolImage(params: {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4';
  imageBase64?: string;
  mimeType?: string;
}): Promise<{ imageDataUrl: string; savedPath: string; caption: string }> {
  const ai = getClient();
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  if (params.imageBase64 && params.mimeType) {
    parts.push({
      inlineData: {
        data: params.imageBase64,
        mimeType: params.mimeType,
      },
    });
  }
  parts.push({ text: params.prompt });

  const response = await ai.models.generateContent({
    model: 'gemini-nano-banana-2.1',
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: params.aspectRatio || '1:1',
        imageSize: '1K',
      },
    },
  });

  let imageData = '';
  let imageMime = 'image/png';
  let caption = '';

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      imageData = part.inlineData.data;
      imageMime = part.inlineData.mimeType || 'image/png';
    } else if (part.text) {
      caption += part.text;
    }
  }

  if (!imageData) {
    throw new Error('لم يقم النموذج بإرجاع صورة. يرجى تعديل الوصف والمحاولة مرة أخرى.');
  }

  const ext = imageMime.includes('jpeg') || imageMime.includes('jpg') ? 'jpg' : 'png';
  const filename = `custom_emblem_${Date.now()}.${ext}`;
  const imagesDir = path.resolve(process.cwd(), 'src/assets/images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const diskPath = path.join(imagesDir, filename);
  fs.writeFileSync(diskPath, Buffer.from(imageData, 'base64'));

  return {
    imageDataUrl: `data:${imageMime};base64,${imageData}`,
    savedPath: `/src/assets/images/${filename}`,
    caption: caption.trim(),
  };
}
