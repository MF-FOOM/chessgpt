'use client'

import { Chess, ChessInstance, Move, ShortMove, Square } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import OpenAI from 'openai';
import { Piece } from "react-chessboard/dist/chessboard/types";

const DEFAULT_USER_PROMPT = '[Event \"FIDE World Cup 2023\"]\n[Site \"Baku AZE\"]\n[Date \"2023.08.23\"]\n[EventDate \"2021.07.30\"]\n[Round \"8.2\"]\n[Result \"1/2-1/2\"]\n[White \"Magnus Carlsen\"]\n[Black \"Rameshbabu Praggnanandhaa\"]\n[ECO \"C48\"]\n[WhiteElo \"2835\"]\n[BlackElo \"2690\"]\n[PlyCount \"60\"]\n\n'
const DEFAULT_SYSTEM_PROMPT = 'You are a Chess grandmaster that helps analyze and predict live chess games. Given the algebraic notation for a given match, predict the next move. Do not return anything except for the algebraic notation for your prediction.'
const DEFAULT_MODEL: Model = 'gpt-3.5-turbo-instruct'

type CompletionModel = 'gpt-3.5-turbo-instruct' // 'gpt-4-base' -> https://openai.com/careers/
type ChatModel = 'gpt-4' | 'gpt-3.5-turbo'
type Model = CompletionModel | ChatModel

const useChatCompletions = {
  'gpt-4': true,
  'gpt-3.5-turbo': true,
  'gpt-3.5-turbo-instruct': false,
}

let openai: OpenAI;

async function chatCompletionsQuery(model: ChatModel, game: ChessInstance, system: string, prompt: string) {
  const possibleMoves = game.moves();
  if (game.game_over() || game.in_draw() || possibleMoves.length === 0) return null;

  const response = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        "role": "system",
        "content": system
      },
      {
        "role": "user",
        "content": prompt + game.pgn() || '1. '
      }
    ],
    temperature: 1,
    max_tokens: 10,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const response_content = response.choices[0].message.content;
  if (!response_content) throw new Error('No choice found');
  let choice = response_content.trim().split(' ').filter(item => !item.includes('.'))[0]
  const move = possibleMoves.find((move) => move === choice);
  console.log(`Moves: ${possibleMoves}, choice: ${choice}, raw: ${response_content}, found_move: ${move}`)
  if (!move) return null
  return move;
}


async function completionsQuery(model: CompletionModel, game: ChessInstance, prompt: string) {
  const possibleMoves = game.moves();
  if (game.game_over() || game.in_draw() || possibleMoves.length === 0) return null;

  console.log(`PGN: ${game.pgn()}, length: ${game.pgn().length}`)

  const completion = await openai.completions.create({
    prompt: prompt + game.pgn() || '1. ',
    model: model,
    temperature: 1,
    max_tokens: 10,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  const response_content = completion.choices[0].text
  let choice = response_content.trim().split(' ').filter(item => !item.includes('.'))[0]
  const move = possibleMoves.find((move) => move === choice);
  console.log(`Moves: ${possibleMoves}, choice: ${choice}, raw: ${response_content}, found_move: ${move}`)
  if (!move) return null
  return move;
}

export default function PlayEngine() {
  const [game, setGame] = useState(new Chess());
  const [model, setModel] = useState<Model>(DEFAULT_MODEL);
  const [lastMessage, setLastMessage] = useState("");
  const [PGNInput, setPGNInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!key) {
      key = prompt('Please enter your OpenAI API key (local only):') || '';
      console.log('key', key);
    }
    openai = new OpenAI({
      organization: 'openai-internal',
      apiKey: key,
      dangerouslyAllowBrowser: true,
    })
  }, []);

  // AutoPlay logic
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [model2, setModel2] = useState<Model>(DEFAULT_MODEL);
  const isAutoPlayRef = useRef(isAutoPlay);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isAutoPlay) {
      timeoutId = setTimeout(autoPlay, 200);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isAutoPlay]);

  useEffect(() => {
    isAutoPlayRef.current = isAutoPlay;
  }, [isAutoPlay]);

  async function autoPlay() {
    if (!isAutoPlayRef.current) return;

    const currentModel = game.turn() === 'w' ? model : model2;
    const move = useChatCompletions[currentModel]
      ? await chatCompletionsQuery(currentModel as ChatModel, game, systemPrompt, userPrompt)
      : await completionsQuery(currentModel as CompletionModel, game, userPrompt);

    if (!move) {
      if (retryCount < 3) {
        setRetryCount(retryCount + 1);
        setTimeout(autoPlay, 200);
        return
      } else {
        setIsAutoPlay(false);
        setRetryCount(0);
        return setLastMessage('No/invalid move found by model after 3 retries. AutoPlay stopped.');
      }
    }

    setRetryCount(0);
    setLastMessage(`Model suggests move: ${move}.`);
    movePiece(move);
    setTimeout(autoPlay, 200);
  }

  function resetBoard() {
    setGame(new Chess());
    setLastMessage("");
  }

  function setGameStateFromPGN(pgn: string) {
    const gameCopy = { ...game };
    const isLoaded = gameCopy.load_pgn(pgn);
    if (!isLoaded) {
      console.error('Invalid PGN provided');
      setPGNInput('Invalid PGN provided');
      return;
    }
    setPGNInput('');
    setGame({ ...gameCopy });
  }

  function movePiece(move: ShortMove | string) {
    const gameCopy = { ...game };
    const result = gameCopy.move(move);
    setGame(gameCopy);
    return result;
  }

  async function makeChatCompletionsMove() {
    const move = await chatCompletionsQuery(model as ChatModel, game, systemPrompt, userPrompt);
    if (!move) return setLastMessage('No/invalid move found by model. Try again by clicking button above.');
    setLastMessage(`Model suggests move: ${move}.`);
    movePiece(move);
  }

  async function makeCompletionsMove() {
    const move = await completionsQuery(model as CompletionModel, game, userPrompt);
    if (!move) return setLastMessage('No/invalid move found by model. Try again by clicking button above.');
    setLastMessage(`Model suggests move: ${move}.`);
    movePiece(move);
  }

  function onDrop(sourceSquare: Square, targetSquare: Square, piece: Piece): boolean {
    const move = movePiece({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (move === null) return false;
    setIsAutoPlay(false);
    useChatCompletions[model] ? makeChatCompletionsMove() : makeCompletionsMove();
    return true;
  }

  return (
    <main className="bg-gray-100 min-h-screen p-10">
      <div className="mx-auto flex tt:flex-row flex-col space-x-5 justify-between">
        <div className="controls mb-5 flex flex-col space-y-4">
          <h1 className="text-4xl font-bold">ChessGPT</h1>
          <div className="flex items-center space-x-2">
            <label className="text-xl font-semibold">Select Model:</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as Model)}
              className="border border-gray-300 p-2 rounded-md shadow-sm"
            >
              <option value="gpt-3.5-turbo-instruct">GPT-3.5 Turbo Completions</option>
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
          </div>
          <button
            onClick={resetBoard}
            className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 active:bg-blue-700 focus:outline-none"
          >
            Reset Board
          </button>
          <button
            onClick={() => useChatCompletions[model] ? makeChatCompletionsMove() : makeCompletionsMove()}
            className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 active:bg-blue-700 focus:outline-none"
          >
            Force Model to Make Next Move
          </button>
          <div className="flex flex-col space-y-1">
            <label className="text-xl font-semibold">Set PGN:</label>
            <div className="flex items-center space-x-2">
              <textarea
                rows={2}
                placeholder="Paste PGN here"
                onChange={(e) => setPGNInput(e.target.value)}
                value={PGNInput}
                className="border border-gray-300 p-2 w-full rounded-md shadow-sm"
              />
              <button
                onClick={() => setGameStateFromPGN(PGNInput)}
                className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 active:bg-blue-700 focus:outline-none"
              >
                Set State from PGN
              </button>
            </div>
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-xl font-semibold">Set System Prompt:</label>
            <textarea
              rows={useChatCompletions[model] ? 5 : 1}
              placeholder="Enter system prompt here"
              onChange={(e) => setSystemPrompt(e.target.value)}
              value={useChatCompletions[model] ? DEFAULT_SYSTEM_PROMPT : 'No system prompt for completion models.'}
              className="border border-gray-300 p-2 w-full rounded-md shadow-sm"
              disabled={!useChatCompletions[model]}
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-xl font-semibold">Set User Prompt:</label>
            <textarea
              rows={5}
              placeholder="Enter user prompt here"
              onChange={(e) => setUserPrompt(e.target.value)}
              value={userPrompt}
              className="border border-gray-300 p-2 w-full rounded-md shadow-sm"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <div className="flex justify-between">
              <label className="text-xl font-semibold">Current PGN:</label>
              <button
                id="copyButton"
                onClick={() => {
                  navigator.clipboard.writeText(game.pgn() || '1. ');
                  let copyButton = document.getElementById("copyButton");
                  if (copyButton) {
                    copyButton.innerText = "Copied!";
                    setTimeout(() => {
                      if (copyButton) copyButton.innerText = "Copy PGN";
                    }, 2000);
                  }
                }}
                className="text-slate-500 py-1 px-2 rounded-md hover:text-slate-700 active:text-slate-800 focus:outline-none"
              >
                Copy PGN
              </button>
            </div>
            <div className="flex items-center space-x-2 max-w-[380px]">
              <p className="border border-gray-300 p-2 w-full rounded-md shadow-sm">
                {game.pgn() || '1. '}
              </p>
            </div>
          </div>

        </div>
        <div className="basis-[500px] max-w-[600px] max-h-[600px] m-auto rounded-md">
          <Chessboard position={game.fen()} onPieceDrop={onDrop} />
        </div>
        <div className="mb-5 p-4 rounded-md shadow-sm border border-gray-300 mt-4">
          <h2 className="text-xl font-semibold">Auto Play</h2>
          <div className="flex flex-col mt-1 space-y-1">
            <label className="text-lg font-normal">Select Model 2 (black):</label>
            <select
              value={model2}
              onChange={(e) => setModel2(e.target.value as Model)}
              className="border border-gray-300 p-2 rounded-md shadow-sm"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="gpt-3.5-turbo-instruct">GPT-3.5 Turbo Instruct</option>
            </select>
          </div>
          <button
            onClick={() => setIsAutoPlay(!isAutoPlay)}
            className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 active:bg-blue-700 focus:outline-none mt-3"
          >
            {isAutoPlay ? 'Stop Auto Play' : 'Start Auto Play'}
          </button>
          <hr className="my-4" />
          <div className="mb-5 bg-white p-4 rounded-md shadow-sm mt-2">
            <label className="text-md font-semibold">Last message:</label>
            <p className="mt-2">{lastMessage || '...'}</p>
          </div>
        </div>
      </div>
      <p className="italic text-gray-500">Want to get paid to do research on cutting edge large language models? <a className="underline" href="https://openai.com/careers/">Join OpenAI!</a></p>
    </main>
  );
}