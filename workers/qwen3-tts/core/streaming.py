"""Streaming generation for Qwen3-TTS."""

import torch
import torch.nn.functional as F


def sample_token(logits, temperature, top_p, top_k):
    """Sample next token from logits using temperature, top-p, and top-k."""
    if temperature > 0:
        logits = logits / temperature

    if top_k > 0:
        top_k_values = torch.topk(logits, min(top_k, logits.size(-1)))[0]
        indices_to_remove = logits < top_k_values[..., -1, None]
        logits = logits.masked_fill(indices_to_remove, float("-inf"))

    if top_p < 1.0:
        sorted_logits, sorted_indices = torch.sort(logits, descending=True)
        cumulative_probs = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
        sorted_indices_to_remove = cumulative_probs > top_p
        sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
        sorted_indices_to_remove[..., 0] = False
        indices_to_remove = sorted_indices_to_remove.scatter(
            dim=-1, index=sorted_indices, src=sorted_indices_to_remove
        )
        logits = logits.masked_fill(indices_to_remove, float("-inf"))

    probs = F.softmax(logits, dim=-1)
    return torch.multinomial(probs, num_samples=1)


def generate_streaming(
    tts_model,
    text: str,
    voice_clone_prompt: list,
    language: str = "english",
    chunk_size: int = 25,
    max_new_tokens: int = 4096,
    temperature: float = 0.9,
    top_p: float = 1.0,
    top_k: int = 50,
):
    """
    Streaming generation that yields audio chunks as codes are generated.

    Replicates Qwen3TTSForConditionalGeneration.generate() preprocessing,
    then runs custom loop yielding audio after each chunk of codes.

    Args:
        tts_model: Qwen3TTSModel instance
        text: Text to synthesize
        voice_clone_prompt: List of VoiceClonePromptItem
        language: Language code
        chunk_size: Number of codes before yielding audio (~2s at 25 codes)
        max_new_tokens: Maximum tokens to generate
        temperature: Sampling temperature
        top_p: Nucleus sampling threshold
        top_k: Top-k sampling threshold
    """
    model = tts_model.model
    talker = model.talker
    config = model.config

    voice_clone_prompt_dict = tts_model._prompt_items_to_voice_clone_prompt(
        voice_clone_prompt
    )

    input_text = f"<|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n"
    input_ids = tts_model.processor.tokenizer(
        input_text, return_tensors="pt"
    ).input_ids.to("cuda")

    # === PREPROCESSING ===
    voice_clone_spk_embeds = model.generate_speaker_prompt(voice_clone_prompt_dict)

    if (
        voice_clone_prompt_dict["x_vector_only_mode"][0]
        or voice_clone_prompt_dict["icl_mode"][0]
    ):
        speaker_embed = voice_clone_spk_embeds[0]
    else:
        speaker_embed = None

    if language.lower() == "auto":
        language_id = None
    elif language.lower() in config.talker_config.codec_language_id:
        language_id = config.talker_config.codec_language_id[language.lower()]
    else:
        language_id = None

    tts_special_ids = torch.tensor(
        [[config.tts_bos_token_id, config.tts_eos_token_id, config.tts_pad_token_id]],
        device=talker.device,
        dtype=input_ids.dtype,
    )
    tts_bos_embed, tts_eos_embed, tts_pad_embed = talker.text_projection(
        talker.get_text_embeddings()(tts_special_ids)
    ).chunk(3, dim=1)

    if language_id is None:
        codec_prefill_list = [
            [
                config.talker_config.codec_nothink_id,
                config.talker_config.codec_think_bos_id,
                config.talker_config.codec_think_eos_id,
            ]
        ]
    else:
        codec_prefill_list = [
            [
                config.talker_config.codec_think_id,
                config.talker_config.codec_think_bos_id,
                language_id,
                config.talker_config.codec_think_eos_id,
            ]
        ]

    codec_input_embedding_0 = talker.get_input_embeddings()(
        torch.tensor(codec_prefill_list, device=talker.device, dtype=input_ids.dtype)
    )
    codec_input_embedding_1 = talker.get_input_embeddings()(
        torch.tensor(
            [[config.talker_config.codec_pad_id, config.talker_config.codec_bos_id]],
            device=talker.device,
            dtype=input_ids.dtype,
        )
    )

    if speaker_embed is None:
        codec_input_embedding = torch.cat(
            [codec_input_embedding_0, codec_input_embedding_1], dim=1
        )
    else:
        codec_input_embedding = torch.cat(
            [
                codec_input_embedding_0,
                speaker_embed.view(1, 1, -1),
                codec_input_embedding_1,
            ],
            dim=1,
        )

    role_embed = talker.text_projection(
        talker.get_text_embeddings()(input_ids[:, :3])
    )

    talker_input_embed = (
        torch.cat(
            (
                tts_pad_embed.expand(-1, codec_input_embedding.shape[1] - 2, -1),
                tts_bos_embed,
            ),
            dim=1,
        )
        + codec_input_embedding[:, :-1]
    )

    talker_input_embed = torch.cat((role_embed, talker_input_embed), dim=1)

    ref_code = voice_clone_prompt_dict.get("ref_code", [None])[0]
    is_icl_mode = voice_clone_prompt_dict["icl_mode"][0]

    if ref_code is not None and is_icl_mode:
        ref_text = voice_clone_prompt[0].ref_text
        if ref_text:
            ref_input_text = f"<|im_start|>assistant\n{ref_text}<|im_end|>"
            ref_ids = tts_model.processor.tokenizer(
                ref_input_text, return_tensors="pt"
            ).input_ids.to("cuda")

            icl_input_embed, trailing_text_hidden = model.generate_icl_prompt(
                text_id=input_ids[:, 3:-5],
                ref_id=ref_ids[:, 3:-2],
                ref_code=ref_code.to(talker.device),
                tts_pad_embed=tts_pad_embed,
                tts_eos_embed=tts_eos_embed,
                non_streaming_mode=False,
            )
            talker_input_embed = torch.cat(
                [talker_input_embed, icl_input_embed], dim=1
            )
        else:
            talker_input_embed = torch.cat(
                [
                    talker_input_embed,
                    talker.text_projection(
                        talker.get_text_embeddings()(input_ids[:, 3:4])
                    )
                    + codec_input_embedding[:, -1:],
                ],
                dim=1,
            )
            trailing_text_hidden = torch.cat(
                (
                    talker.text_projection(
                        talker.get_text_embeddings()(input_ids[:, 4:-5])
                    ),
                    tts_eos_embed,
                ),
                dim=1,
            )
    else:
        talker_input_embed = torch.cat(
            [
                talker_input_embed,
                talker.text_projection(
                    talker.get_text_embeddings()(input_ids[:, 3:4])
                )
                + codec_input_embedding[:, -1:],
            ],
            dim=1,
        )
        trailing_text_hidden = torch.cat(
            (
                talker.text_projection(
                    talker.get_text_embeddings()(input_ids[:, 4:-5])
                ),
                tts_eos_embed,
            ),
            dim=1,
        )

    talker_input_embeds = talker_input_embed
    talker_attention_mask = torch.ones(
        (1, talker_input_embeds.shape[1]),
        dtype=torch.long,
        device=talker_input_embeds.device,
    )
    trailing_text_hiddens = trailing_text_hidden

    # === GENERATION LOOP ===
    eos_token_id = config.talker_config.codec_eos_token_id
    accumulated_codes = []
    yielded_audio_samples = 0

    with torch.inference_mode():
        outputs = talker(
            inputs_embeds=talker_input_embeds,
            attention_mask=talker_attention_mask,
            past_key_values=None,
            use_cache=True,
            output_hidden_states=True,
            trailing_text_hidden=trailing_text_hiddens,
            tts_pad_embed=tts_pad_embed,
            generation_step=-1,
        )

    logits = outputs.logits[:, -1, :]
    next_token = sample_token(logits, temperature, top_p, top_k)
    past_key_values = outputs.past_key_values
    past_hidden = outputs.past_hidden
    generation_step = outputs.generation_step

    for step in range(max_new_tokens):
        with torch.inference_mode():
            outputs = talker(
                input_ids=next_token,
                attention_mask=None,
                past_key_values=past_key_values,
                past_hidden=past_hidden,
                use_cache=True,
                output_hidden_states=True,
                trailing_text_hidden=trailing_text_hiddens,
                tts_pad_embed=tts_pad_embed,
                generation_step=generation_step,
            )

        codec_ids = outputs.hidden_states[-1]

        # Check for EOS before appending - don't include EOS in codes to decode
        if codec_ids is not None and codec_ids[0, 0].item() == eos_token_id:
            break

        if codec_ids is not None:
            accumulated_codes.append(codec_ids)

        if len(accumulated_codes) >= chunk_size and len(accumulated_codes) % chunk_size == 0:
            # Decode ALL accumulated codes for proper context
            codes_tensor = torch.stack(accumulated_codes, dim=0).squeeze(1)
            wavs, sr = model.speech_tokenizer.decode([{"audio_codes": codes_tensor}])
            full_audio = wavs[0]
            # Yield only the new portion we haven't sent yet
            if len(full_audio) > yielded_audio_samples:
                yield full_audio[yielded_audio_samples:]
                yielded_audio_samples = len(full_audio)

        logits = outputs.logits[:, -1, :]
        next_token = sample_token(logits, temperature, top_p, top_k)
        past_key_values = outputs.past_key_values
        past_hidden = outputs.past_hidden
        generation_step = outputs.generation_step

    # Decode remaining codes (same context-aware approach)
    if accumulated_codes:
        codes_tensor = torch.stack(accumulated_codes, dim=0).squeeze(1)
        wavs, sr = model.speech_tokenizer.decode([{"audio_codes": codes_tensor}])
        full_audio = wavs[0]
        if len(full_audio) > yielded_audio_samples:
            yield full_audio[yielded_audio_samples:]
