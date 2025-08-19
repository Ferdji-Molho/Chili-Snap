import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const fileForm = await req.formData();
    const file = fileForm.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // Read and encode image
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Call OpenAI Chat Completions API with vision
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a botanist specialized in Capsicum (chili pepper) identification. Analyze the image and return STRICT JSON format: {\"primary\":{\"name\":\"...\",\"species\":\"...\",\"heat_level\":\"...\",\"confidence\":\"...\"},\"alternates\":[{\"name\":\"...\",\"species\":\"...\",\"confidence\":\"...\"}],\"uncertainty\":\"...\"}. Focus only on visible characteristics. No markdown, only JSON."
          },
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: "Identify this chili pepper from the image. Focus on visible traits like size, shape, color, and surface texture. Provide your best identification with confidence level." 
              },
              { 
                type: "image_url", 
                image_url: { url: dataUrl }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 1000
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${errText}` }, { status: 500 });
    }

    const data = await res.json();
    
    // Parse the JSON response from OpenAI
    let result;
    try {
      result = JSON.parse(data.choices[0].message.content);
    } catch (parseError) {
      result = { 
        error: "Failed to parse AI response", 
        raw_response: data.choices[0].message.content 
      };
    }

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("API Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}