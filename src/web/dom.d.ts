type WebInput = { value: string }

declare const location: { search?: string; origin?: string } | undefined
declare const navigator: { clipboard?: { writeText(text: string): Promise<void> } } | undefined
declare const document: { getElementById(id: string): HTMLElement | null }
