import type { Metadata } from "next";
import { Noto_Serif_SC, Ma_Shan_Zheng } from "next/font/google";
import "./globals.css";

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const maShanZheng = Ma_Shan_Zheng({
  variable: "--font-calligraphy",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "笔墨 · 习字 | 汉字笔顺演示",
  description: "以水墨书法风格呈现汉字笔画顺序，在数字时代感受传统笔墨之美",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${notoSerifSC.variable} ${maShanZheng.variable} h-full antialiased`}>
        {children}
      </body>
    </html>
  );
}